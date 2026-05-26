/**
 * Groups.io MCP Server — extracted business logic
 *
 * All functions are exported with injectable dependencies for testability.
 * External boundaries (HTTP, config) are injected rather than hard-coded.
 */

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Resolve group: use provided value, fall back to default, or throw.
 */
export function resolveGroup(groupName, defaultGroup) {
  const g = groupName || defaultGroup;
  if (!g) {
    throw new Error(
      "No group specified. Pass group_name or set GROUPSIO_GROUP env var.",
    );
  }
  return g;
}

/**
 * Convert raw DatabaseRow array + column definitions into plain objects
 * keyed by column name — much easier for an LLM to reason over.
 *
 * Input rows look like:
 *   { id: 123, values: [ { column_id: 7, value: "Alice" }, ... ] }
 *
 * Output:
 *   [ { _row_id: 123, Name: "Alice", Email: "alice@example.com", ... }, ... ]
 */
export function rowsToRecords(rows, columns) {
  const colById = Object.fromEntries(columns.map((c) => [c.id, c.name]));
  return rows.map((row) => {
    const record = { _row_id: row.id };
    for (const val of row.values ?? []) {
      const colName = colById[val.column_id] ?? `col_${val.column_id}`;
      record[colName] = val.value;
    }
    return record;
  });
}

// ---------------------------------------------------------------------------
// API client (injectable fetch for testability)
// ---------------------------------------------------------------------------

export function createApiClient({
  apiKey,
  baseUrl = "https://groups.io/api/v1",
  fetchFn = globalThis.fetch,
}) {
  async function apiGet(endpoint, params = {}) {
    const url = new URL(`${baseUrl}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const res = await fetchFn(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const body = await res.json();

    if (!res.ok || body.object === "error") {
      const msg = body.type ?? res.statusText;
      const extra = body.extra ? ` (${body.extra})` : "";
      throw new Error(`Groups.io API error: ${msg}${extra}`);
    }

    return body;
  }

  /**
   * Fetch every page of a paginated endpoint and return all items combined.
   * Groups.io max limit is 100 per page.
   */
  async function fetchAllPages(endpoint, params = {}) {
    const items = [];
    let pageToken = undefined;

    while (true) {
      const page = await apiGet(endpoint, {
        ...params,
        limit: 100,
        ...(pageToken !== undefined ? { page_token: pageToken } : {}),
      });

      if (page.data) items.push(...page.data);

      if (!page.has_more || !page.next_page_token) break;
      pageToken = page.next_page_token;
    }

    return items;
  }

  return { apiGet, fetchAllPages };
}

// ---------------------------------------------------------------------------
// Tool handlers (separated from MCP wiring for testability)
// ---------------------------------------------------------------------------

/**
 * Find a table by ID or name (case-insensitive) in an array of tables.
 * Throws a descriptive error if not found.
 */
export function findTable(tables, { tableId, tableName }) {
  let table;
  if (tableId) {
    table = tables.find((t) => t.id === tableId);
  } else if (tableName) {
    const needle = tableName.toLowerCase();
    table = tables.find((t) => t.name.toLowerCase() === needle);
  } else {
    throw new Error("Either table_name or table_id must be provided.");
  }

  if (!table) {
    const names = tables.map((t) => `"${t.name}"`).join(", ");
    throw new Error(`Table not found. Available tables: ${names || "(none)"}`);
  }

  return table;
}

export function createToolHandlers(client, defaultGroup) {
  async function listDatabases({ group_name }) {
    const group = resolveGroup(group_name, defaultGroup);
    const tables = await client.fetchAllPages("getdatabases", {
      group_name: group,
    });

    if (tables.length === 0) {
      return {
        content: [{ type: "text", text: "No databases found in this group." }],
      };
    }

    const lines = tables.map(
      (t) =>
        `• ${t.name} (id: ${t.id})` +
        (t.desc ? ` — ${t.desc}` : "") +
        ` [${(t.columns ?? []).length} columns]`,
    );

    return {
      content: [
        {
          type: "text",
          text: `Databases in "${group}":\n\n${lines.join("\n")}`,
        },
      ],
    };
  }

  async function describeDatabase({ group_name, table_name, table_id }) {
    const group = resolveGroup(group_name, defaultGroup);
    const tables = await client.fetchAllPages("getdatabases", {
      group_name: group,
    });

    const table = findTable(tables, {
      tableId: table_id,
      tableName: table_name,
    });
    const columns = table.columns ?? [];

    if (columns.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Table "${table.name}" (id: ${table.id}) has no columns defined.`,
          },
        ],
      };
    }

    const colLines = columns.map(
      (c) => `  • ${c.name} (id: ${c.id}, type: ${c.type ?? "unknown"})`,
    );

    const text =
      `Table: "${table.name}" (id: ${table.id})\n` +
      (table.desc ? `Description: ${table.desc}\n` : "") +
      `\nColumns (${columns.length}):\n${colLines.join("\n")}`;

    return { content: [{ type: "text", text }] };
  }

  async function queryDatabase({
    group_name,
    table_name,
    table_id,
    max_rows = 500,
  }) {
    const group = resolveGroup(group_name, defaultGroup);
    const tables = await client.fetchAllPages("getdatabases", {
      group_name: group,
    });

    const table = findTable(tables, {
      tableId: table_id,
      tableName: table_name,
    });
    const columns = table.columns ?? [];

    // Fetch rows, respecting max_rows cap
    const allRows = [];
    let pageToken = undefined;
    let truncated = false;

    while (true) {
      const remaining = max_rows - allRows.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      const page = await client.apiGet("getdatabaserows", {
        database_id: table.id,
        limit: Math.min(100, remaining),
        ...(pageToken !== undefined ? { page_token: pageToken } : {}),
      });

      if (page.data) allRows.push(...page.data);

      if (!page.has_more || !page.next_page_token) break;
      pageToken = page.next_page_token;
    }

    const records = rowsToRecords(allRows, columns);

    const summary =
      `Table: "${table.name}" — ${records.length} row(s) returned` +
      (truncated ? ` (truncated at max_rows=${max_rows})` : "") +
      `\nColumns: ${columns.map((c) => c.name).join(", ")}\n\n`;

    return {
      content: [
        {
          type: "text",
          text: summary + JSON.stringify(records, null, 2),
        },
      ],
    };
  }

  return { listDatabases, describeDatabase, queryDatabase };
}

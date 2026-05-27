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
 * Wrap a plain text string in the MCP content envelope every tool handler returns.
 */
function textResult(text) {
  return { content: [{ type: "text", text }] };
}

/**
 * Derive a human-readable role from a Groups.io mod_status string.
 */
function deriveRole(mod_status) {
  if (mod_status === "sub_modstatus_owner") return "owner";
  if (mod_status === "sub_modstatus_moderator") return "moderator";
  return "member";
}

/**
 * Extract a human-readable value from a single `vals` entry.
 * The API stores values in type-specific fields, not a generic `value` field.
 */
function extractValue(val, col) {
  switch (val.col_type) {
    case "text_column":
    case "paragraph_column":
      return val.text ?? null;

    case "address_column": {
      const stateZip =
        val.state && val.zip
          ? `${val.state} ${val.zip}`
          : val.state || val.zip || null;
      const parts = [
        val.street_address1,
        val.city,
        stateZip,
        val.country,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(", ") : null;
    }

    case "multi_choice_column": {
      // multi_choice holds an array of 1-based indices into col.choices
      const indices = val.multi_choice;
      if (!indices || indices.length === 0) return null;
      if (col?.choices) {
        return indices.map((i) => col.choices[i - 1]).filter(Boolean);
      }
      return indices;
    }

    case "multiple_choice_column": {
      // Same encoding as multi_choice_column but semantically single-select
      const indices = val.multi_choice;
      if (!indices || indices.length === 0) return null;
      if (col?.choices) {
        return col.choices[indices[0] - 1] ?? null;
      }
      return indices[0];
    }

    case "checkbox_column":
      return val.checked ?? null;

    default:
      return val.text ?? null;
  }
}

/**
 * Convert raw DatabaseRow array + column definitions into plain objects
 * keyed by column name — much easier for an LLM to reason over.
 *
 * The API returns rows like:
 *   { id: 123, vals: [ { col_id: 1, col_type: "text_column", text: "Alice" }, ... ] }
 *
 * Output:
 *   [ { _row_id: 123, Name: "Alice", Email: "alice@example.com", ... }, ... ]
 *
 * Null/empty values are omitted to keep output compact.
 */
export function rowsToRecords(rows, columns) {
  // Map by id to the full column object so extractValue can access choices
  const colById = Object.fromEntries(columns.map((c) => [c.id, c]));
  return rows.map((row) => {
    const record = { _row_id: row.id };
    for (const val of row.vals ?? []) {
      const col = colById[val.col_id];
      const colName = col?.name ?? `col_${val.col_id}`;
      const extracted = extractValue(val, col);
      if (extracted !== null) {
        record[colName] = extracted;
      }
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
      return textResult("No databases found in this group.");
    }

    const lines = tables.map(
      (t) =>
        `• ${t.name} (id: ${t.id})` +
        (t.desc ? ` — ${t.desc}` : "") +
        ` [${(t.columns ?? []).length} columns]`,
    );

    return textResult(`Databases in "${group}":\n\n${lines.join("\n")}`);
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
      return textResult(
        `Table "${table.name}" (id: ${table.id}) has no columns defined.`,
      );
    }

    const colLines = columns.map(
      (c) => `  • ${c.name} (id: ${c.id}, type: ${c.type ?? "unknown"})`,
    );

    const text =
      `Table: "${table.name}" (id: ${table.id})\n` +
      (table.desc ? `Description: ${table.desc}\n` : "") +
      `\nColumns (${columns.length}):\n${colLines.join("\n")}`;

    return textResult(text);
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

    return textResult(summary + JSON.stringify(records, null, 2));
  }

  async function getGroup({ group_name } = {}) {
    const group = resolveGroup(group_name, defaultGroup);
    const g = await client.apiGet("getgroup", { group_name: group });

    const lines = [
      `Group: "${g.name}"`,
      `Plan: ${g.plan}`,
      `Members: ${g.subs_count}`,
      `Email: ${g.email_address ?? g.email ?? "(not set)"}`,
      `Description: ${g.plain_desc || "(no description)"}`,
    ];

    return textResult(lines.join("\n"));
  }

  async function getMembers({ group_name, type } = {}) {
    const group = resolveGroup(group_name, defaultGroup);
    const resolvedType = type || "members";
    const members = await client.fetchAllPages("getmembers", {
      group_name: group,
      type: resolvedType,
    });

    const body =
      members.length === 0
        ? "No members found."
        : `${members.length} found\n\n` +
          members
            .map(
              (m) =>
                `- ${m.email} | ${m.full_name} | delivery: ${m.email_delivery} | status: ${m.status}`,
            )
            .join("\n");

    return textResult(`Members in "${group}" (${resolvedType}): ${body}`);
  }

  async function listSubgroups({ group_name } = {}) {
    const group = resolveGroup(group_name, defaultGroup);
    const subgroups = await client.fetchAllPages("getsubgroups", {
      group_name: group,
    });

    if (subgroups.length === 0) {
      return textResult("No subgroups found.");
    }

    const lines = subgroups.map(
      (s) =>
        `- ${s.name} | ${s.subs_count} members` +
        (s.plain_desc ? ` | ${s.plain_desc}` : ""),
    );

    return textResult(`Subgroups in "${group}":\n\n${lines.join("\n")}`);
  }

  async function getSubscriptions({} = {}) {
    const subs = await client.fetchAllPages("getsubs", {});

    if (subs.length === 0) {
      return textResult("Not subscribed to any groups.");
    }

    const lines = subs.map(
      (s) =>
        `- ${s.group_name} (id: ${s.group_id}) | ${s.subs_count} members | delivery: ${s.email_delivery} | role: ${deriveRole(s.mod_status)}`,
    );

    return textResult(`Subscribed groups: ${subs.length}\n${lines.join("\n")}`);
  }

  async function getMessage({ group_name, msg_num } = {}) {
    if (!msg_num) {
      throw new Error("msg_num is required.");
    }
    const group = resolveGroup(group_name, defaultGroup);
    const m = await client.apiGet("getmessage", { group_name: group, msg_num });

    const lines = [
      `Message #${m.msg_num} in "${group}"`,
      `Subject: ${m.subject}`,
      `From: ${m.from}`,
      `Date: ${m.date.split("T")[0]}`,
    ];

    if (m.body) {
      lines.push("---");
      lines.push(m.body);
    }

    return textResult(lines.join("\n"));
  }

  async function getMessages({ group_name, limit = 20 } = {}) {
    const group = resolveGroup(group_name, defaultGroup);
    const page = await client.apiGet("getmessages", {
      group_name: group,
      limit: Math.min(limit, 100),
    });

    const messages = page.data ?? [];

    if (messages.length === 0) {
      return textResult("No messages found in this group.");
    }

    const lines = messages.map(
      (m) =>
        `[${m.msg_num}] ${m.subject} | from: ${m.from} | ${m.date.split("T")[0]}`,
    );

    return textResult(lines.join("\n"));
  }

  async function listTopics({ group_name, limit = 20 } = {}) {
    const group = resolveGroup(group_name, defaultGroup);
    const page = await client.apiGet("gettopics", {
      group_name: group,
      limit: Math.min(limit, 100),
    });

    const topics = page.data ?? [];

    if (topics.length === 0) {
      return textResult("No topics found in this group.");
    }

    const lines = topics.map((t) => {
      const count =
        t.num_messages !== undefined
          ? ` | ${t.num_messages} msg${t.num_messages !== 1 ? "s" : ""}`
          : "";
      const date = t.last_post_date
        ? ` | ${t.last_post_date.split("T")[0]}`
        : "";
      return `- [${t.id}] ${t.subject}${count}${date}`;
    });

    return textResult(
      `Recent topics in "${group}" (${topics.length}):\n\n${lines.join("\n")}`,
    );
  }

  async function searchArchives({ group_name, q, limit = 20 } = {}) {
    if (!q) {
      throw new Error("A search query is required.");
    }
    const group = resolveGroup(group_name, defaultGroup);
    const page = await client.apiGet("searcharchives", {
      group_name: group,
      q,
      limit: Math.min(limit, 100),
    });

    const results = page.data ?? [];

    if (results.length === 0) {
      return textResult(`No results found for "${q}" in "${group}".`);
    }

    const lines = results.map(
      (m) =>
        `[${m.msg_num}] ${m.subject} | from: ${m.from} | ${m.date.split("T")[0]}`,
    );

    return textResult(
      `Search results for "${q}" in "${group}" (${results.length} found):\n${lines.join("\n")}`,
    );
  }

  return {
    listDatabases,
    describeDatabase,
    queryDatabase,
    getGroup,
    getMembers,
    listSubgroups,
    getSubscriptions,
    getMessage,
    getMessages,
    listTopics,
    searchArchives,
  };
}

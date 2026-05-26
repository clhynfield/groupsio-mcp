import { describe, it, expect, vi } from "vitest";
import {
  resolveGroup,
  rowsToRecords,
  findTable,
  createApiClient,
  createToolHandlers,
} from "../groupsio.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Returns a vi.fn() that behaves like fetch returning a successful JSON response. */
function fakeFetch(body, { ok = true, statusText = "OK" } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    statusText,
    json: () => Promise.resolve(body),
  });
}

/** Builds a fake client with stub apiGet/fetchAllPages for tool handler tests. */
function fakeClient({ tables = [], rowPages = [] } = {}) {
  let rowPageIndex = 0;
  return {
    fetchAllPages: vi.fn().mockResolvedValue(tables),
    apiGet: vi.fn().mockImplementation(() => {
      const page = rowPages[rowPageIndex] ?? { data: [], has_more: false };
      rowPageIndex++;
      return Promise.resolve(page);
    }),
  };
}

// ---------------------------------------------------------------------------
// resolveGroup
// ---------------------------------------------------------------------------

describe("resolveGroup", () => {
  it("returns the provided group name when given", () => {
    expect(resolveGroup("mygroup", undefined)).toBe("mygroup");
  });

  it("falls back to the default when no name is provided", () => {
    expect(resolveGroup(undefined, "fallback")).toBe("fallback");
  });

  it("falls back to the default when name is empty string", () => {
    expect(resolveGroup("", "fallback")).toBe("fallback");
  });

  it("prefers the provided name over the default", () => {
    expect(resolveGroup("explicit", "fallback")).toBe("explicit");
  });

  it("throws when neither name nor default is available", () => {
    expect(() => resolveGroup(undefined, undefined)).toThrow(
      "No group specified",
    );
  });

  it("throws when both are empty strings", () => {
    expect(() => resolveGroup("", "")).toThrow("No group specified");
  });
});

// ---------------------------------------------------------------------------
// rowsToRecords
// ---------------------------------------------------------------------------

describe("rowsToRecords", () => {
  const columns = [
    { id: 1, name: "Name", type: "text_column" },
    { id: 2, name: "Email", type: "text_column" },
    { id: 3, name: "State", type: "text_column" },
  ];

  it("converts raw rows into objects keyed by column name", () => {
    const rows = [
      {
        id: 100,
        vals: [
          { col_id: 1, col_type: "text_column", text: "Alice" },
          { col_id: 2, col_type: "text_column", text: "alice@example.com" },
        ],
      },
    ];

    const records = rowsToRecords(rows, columns);

    expect(records).toEqual([
      { _row_id: 100, Name: "Alice", Email: "alice@example.com" },
    ]);
  });

  it("includes _row_id from the row's id field", () => {
    const rows = [{ id: 42, vals: [] }];
    expect(rowsToRecords(rows, columns)[0]._row_id).toBe(42);
  });

  it("handles rows with empty vals array", () => {
    const rows = [{ id: 1, vals: [] }];
    expect(rowsToRecords(rows, columns)).toEqual([{ _row_id: 1 }]);
  });

  it("handles rows where vals is undefined (missing key)", () => {
    const rows = [{ id: 1 }];
    expect(rowsToRecords(rows, columns)).toEqual([{ _row_id: 1 }]);
  });

  it("omits fields whose value is null/empty", () => {
    const rows = [{ id: 1, vals: [{ col_id: 1, col_type: "text_column" }] }];
    // text is absent → null → should be omitted from the record
    expect(rowsToRecords(rows, columns)[0]).not.toHaveProperty("Name");
  });

  it("uses col_<id> fallback for unrecognized column IDs", () => {
    const rows = [
      {
        id: 1,
        vals: [{ col_id: 999, col_type: "text_column", text: "mystery" }],
      },
    ];

    expect(rowsToRecords(rows, columns)[0]).toHaveProperty(
      "col_999",
      "mystery",
    );
  });

  it("handles multiple rows", () => {
    const rows = [
      { id: 1, vals: [{ col_id: 1, col_type: "text_column", text: "Alice" }] },
      { id: 2, vals: [{ col_id: 1, col_type: "text_column", text: "Bob" }] },
    ];

    const records = rowsToRecords(rows, columns);

    expect(records).toHaveLength(2);
    expect(records[0].Name).toBe("Alice");
    expect(records[1].Name).toBe("Bob");
  });

  it("returns an empty array for empty input", () => {
    expect(rowsToRecords([], columns)).toEqual([]);
  });

  it("formats address_column as a readable string", () => {
    const cols = [{ id: 7, name: "Address", type: "address_column" }];
    const rows = [
      {
        id: 1,
        vals: [
          {
            col_id: 7,
            col_type: "address_column",
            street_address1: "123 Main St",
            city: "Springfield",
            state: "OH",
            zip: "45001",
            country: "United States",
          },
        ],
      },
    ];
    expect(rowsToRecords(rows, cols)[0].Address).toBe(
      "123 Main St, Springfield, OH 45001, United States",
    );
  });

  it("resolves multi_choice_column indices to label strings (1-based)", () => {
    const cols = [
      {
        id: 12,
        name: "Co-op",
        type: "multi_choice_column",
        choices: ["Alpha", "Beta", "Gamma"],
      },
    ];
    const rows = [
      {
        id: 1,
        vals: [
          { col_id: 12, col_type: "multi_choice_column", multi_choice: [1, 3] },
        ],
      },
    ];
    expect(rowsToRecords(rows, cols)[0]["Co-op"]).toEqual(["Alpha", "Gamma"]);
  });

  it("resolves multiple_choice_column index to a single label string (1-based)", () => {
    const cols = [
      {
        id: 13,
        name: "Membership Type",
        type: "multiple_choice_column",
        choices: ["Alumni", "Legacy", "Regular"],
      },
    ];
    const rows = [
      {
        id: 1,
        vals: [
          { col_id: 13, col_type: "multiple_choice_column", multi_choice: [3] },
        ],
      },
    ];
    expect(rowsToRecords(rows, cols)[0]["Membership Type"]).toBe("Regular");
  });

  it("includes checkbox_column values (true and false)", () => {
    const cols = [
      { id: 18, name: "Verified", type: "checkbox_column" },
      { id: 19, name: "Lapsed", type: "checkbox_column" },
    ];
    const rows = [
      {
        id: 1,
        vals: [
          { col_id: 18, col_type: "checkbox_column", checked: true },
          { col_id: 19, col_type: "checkbox_column", checked: false },
        ],
      },
    ];
    const record = rowsToRecords(rows, cols)[0];
    expect(record.Verified).toBe(true);
    expect(record.Lapsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findTable
// ---------------------------------------------------------------------------

describe("findTable", () => {
  const tables = [
    { id: 10, name: "Members", columns: [] },
    { id: 20, name: "Contacts", columns: [] },
  ];

  it("finds a table by numeric ID", () => {
    expect(findTable(tables, { tableId: 10 })).toBe(tables[0]);
  });

  it("finds a table by name (case-insensitive)", () => {
    expect(findTable(tables, { tableName: "members" })).toBe(tables[0]);
    expect(findTable(tables, { tableName: "CONTACTS" })).toBe(tables[1]);
  });

  it("prefers tableId over tableName when both are given", () => {
    const result = findTable(tables, { tableId: 20, tableName: "Members" });
    expect(result.name).toBe("Contacts");
  });

  it("throws when neither tableId nor tableName is provided", () => {
    expect(() => findTable(tables, {})).toThrow(
      "Either table_name or table_id must be provided",
    );
  });

  it("throws with available table names when table is not found", () => {
    expect(() => findTable(tables, { tableName: "Nope" })).toThrow(
      'Available tables: "Members", "Contacts"',
    );
  });

  it("throws with (none) when table list is empty", () => {
    expect(() => findTable([], { tableName: "Nope" })).toThrow(
      "Available tables: (none)",
    );
  });
});

// ---------------------------------------------------------------------------
// createApiClient — apiGet
// ---------------------------------------------------------------------------

describe("createApiClient", () => {
  const apiKey = "test-key-abc";
  const baseUrl = "https://api.test.io/v1";

  describe("apiGet", () => {
    it("sends a GET to the correct URL with Bearer auth", async () => {
      const fetchFn = fakeFetch({ data: [] });
      const { apiGet } = createApiClient({ apiKey, baseUrl, fetchFn });

      await apiGet("getdatabases", { group_name: "mygroup" });

      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, opts] = fetchFn.mock.calls[0];
      expect(url).toBe(
        "https://api.test.io/v1/getdatabases?group_name=mygroup",
      );
      expect(opts.headers.Authorization).toBe("Bearer test-key-abc");
    });

    it("omits undefined and null params from the query string", async () => {
      const fetchFn = fakeFetch({ data: [] });
      const { apiGet } = createApiClient({ apiKey, baseUrl, fetchFn });

      await apiGet("getdatabases", {
        group_name: "g",
        skip_me: undefined,
        also_skip: null,
      });

      const [url] = fetchFn.mock.calls[0];
      expect(url).toContain("group_name=g");
      expect(url).not.toContain("skip_me");
      expect(url).not.toContain("also_skip");
    });

    it("converts numeric params to strings", async () => {
      const fetchFn = fakeFetch({ data: [] });
      const { apiGet } = createApiClient({ apiKey, baseUrl, fetchFn });

      await apiGet("getdatabaserows", { database_id: 42, limit: 100 });

      const [url] = fetchFn.mock.calls[0];
      expect(url).toContain("database_id=42");
      expect(url).toContain("limit=100");
    });

    it("throws on HTTP error with API error body", async () => {
      const fetchFn = fakeFetch(
        { object: "error", type: "bad_request", extra: "invalid group_id" },
        { ok: false },
      );
      const { apiGet } = createApiClient({ apiKey, baseUrl, fetchFn });

      await expect(apiGet("getdatabases")).rejects.toThrow(
        "Groups.io API error: bad_request (invalid group_id)",
      );
    });

    it("throws when body indicates error even on HTTP 200", async () => {
      const fetchFn = fakeFetch({
        object: "error",
        type: "inadequate_permissions",
        extra: "",
      });
      const { apiGet } = createApiClient({ apiKey, baseUrl, fetchFn });

      await expect(apiGet("getdatabases")).rejects.toThrow(
        "Groups.io API error: inadequate_permissions",
      );
    });

    it("falls back to statusText when error body has no type", async () => {
      const fetchFn = fakeFetch({}, { ok: false, statusText: "Forbidden" });
      const { apiGet } = createApiClient({ apiKey, baseUrl, fetchFn });

      await expect(apiGet("getdatabases")).rejects.toThrow(
        "Groups.io API error: Forbidden",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // createApiClient — fetchAllPages
  // ---------------------------------------------------------------------------

  describe("fetchAllPages", () => {
    it("returns data from a single page", async () => {
      const fetchFn = fakeFetch({
        data: [{ id: 1 }, { id: 2 }],
        has_more: false,
      });
      const { fetchAllPages } = createApiClient({ apiKey, baseUrl, fetchFn });

      const result = await fetchAllPages("getdatabases", {
        group_name: "test",
      });

      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("accumulates data across multiple pages", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: 1 }],
              has_more: true,
              next_page_token: 42,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: 2 }],
              has_more: false,
            }),
        });
      const { fetchAllPages } = createApiClient({ apiKey, baseUrl, fetchFn });

      const result = await fetchAllPages("getdatabases", {
        group_name: "test",
      });

      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("passes page_token on subsequent requests", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: 1 }],
              has_more: true,
              next_page_token: 99,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 2 }], has_more: false }),
        });
      const { fetchAllPages } = createApiClient({ apiKey, baseUrl, fetchFn });

      await fetchAllPages("getdatabases", { group_name: "test" });

      const firstUrl = fetchFn.mock.calls[0][0];
      const secondUrl = fetchFn.mock.calls[1][0];
      expect(firstUrl).not.toContain("page_token");
      expect(secondUrl).toContain("page_token=99");
    });

    it("requests limit=100 on every page", async () => {
      const fetchFn = fakeFetch({ data: [], has_more: false });
      const { fetchAllPages } = createApiClient({ apiKey, baseUrl, fetchFn });

      await fetchAllPages("getdatabases", { group_name: "test" });

      const [url] = fetchFn.mock.calls[0];
      expect(url).toContain("limit=100");
    });

    it("returns empty array when response has no data field", async () => {
      const fetchFn = fakeFetch({ has_more: false });
      const { fetchAllPages } = createApiClient({ apiKey, baseUrl, fetchFn });

      expect(await fetchAllPages("getdatabases")).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Tool handlers — listDatabases
// ---------------------------------------------------------------------------

describe("listDatabases", () => {
  it("returns a formatted list of databases", async () => {
    const client = fakeClient({
      tables: [
        {
          id: 1,
          name: "Members",
          desc: "Member directory",
          columns: [{ id: 10 }, { id: 11 }],
        },
        { id: 2, name: "Events", desc: "", columns: [] },
      ],
    });
    const { listDatabases } = createToolHandlers(client, "testgroup");

    const result = await listDatabases({});

    const text = result.content[0].text;
    expect(text).toContain('Databases in "testgroup"');
    expect(text).toContain("Members (id: 1) — Member directory [2 columns]");
    expect(text).toContain("Events (id: 2) [0 columns]");
  });

  it("fetches databases for the correct group", async () => {
    const client = fakeClient({ tables: [] });
    const { listDatabases } = createToolHandlers(client, "default-group");

    await listDatabases({ group_name: "explicit-group" });

    expect(client.fetchAllPages).toHaveBeenCalledWith("getdatabases", {
      group_name: "explicit-group",
    });
  });

  it("falls back to the default group", async () => {
    const client = fakeClient({ tables: [] });
    const { listDatabases } = createToolHandlers(client, "default-group");

    await listDatabases({});

    expect(client.fetchAllPages).toHaveBeenCalledWith("getdatabases", {
      group_name: "default-group",
    });
  });

  it("returns a helpful message when no databases exist", async () => {
    const client = fakeClient({ tables: [] });
    const { listDatabases } = createToolHandlers(client, "testgroup");

    const result = await listDatabases({});

    expect(result.content[0].text).toBe("No databases found in this group.");
  });
});

// ---------------------------------------------------------------------------
// Tool handlers — describeDatabase
// ---------------------------------------------------------------------------

describe("describeDatabase", () => {
  const tables = [
    {
      id: 5,
      name: "Contacts",
      desc: "All contacts",
      columns: [
        { id: 100, name: "Name", type: "text_column" },
        { id: 101, name: "Phone", type: "text_column" },
      ],
    },
  ];

  it("returns column schema for a table found by name", async () => {
    const client = fakeClient({ tables });
    const { describeDatabase } = createToolHandlers(client, "g");

    const result = await describeDatabase({ table_name: "Contacts" });

    const text = result.content[0].text;
    expect(text).toContain('Table: "Contacts" (id: 5)');
    expect(text).toContain("Description: All contacts");
    expect(text).toContain("Columns (2):");
    expect(text).toContain("Name (id: 100, type: text_column)");
    expect(text).toContain("Phone (id: 101, type: text_column)");
  });

  it("returns column schema for a table found by ID", async () => {
    const client = fakeClient({ tables });
    const { describeDatabase } = createToolHandlers(client, "g");

    const result = await describeDatabase({ table_id: 5 });

    expect(result.content[0].text).toContain('Table: "Contacts"');
  });

  it("reports 'unknown' for columns missing a type", async () => {
    const client = fakeClient({
      tables: [{ id: 1, name: "T", columns: [{ id: 1, name: "X" }] }],
    });
    const { describeDatabase } = createToolHandlers(client, "g");

    const result = await describeDatabase({ table_name: "T" });

    expect(result.content[0].text).toContain("type: unknown");
  });

  it("handles tables with no columns", async () => {
    const client = fakeClient({
      tables: [{ id: 1, name: "Empty", columns: [] }],
    });
    const { describeDatabase } = createToolHandlers(client, "g");

    const result = await describeDatabase({ table_name: "Empty" });

    expect(result.content[0].text).toContain("has no columns defined");
  });
});

// ---------------------------------------------------------------------------
// Tool handlers — queryDatabase
// ---------------------------------------------------------------------------

describe("queryDatabase", () => {
  const tables = [
    {
      id: 7,
      name: "Members",
      columns: [
        { id: 1, name: "Name" },
        { id: 2, name: "State" },
      ],
    },
  ];

  it("fetches rows and returns them as structured records", async () => {
    const client = fakeClient({
      tables,
      rowPages: [
        {
          data: [
            {
              id: 100,
              vals: [
                { col_id: 1, col_type: "text_column", text: "Alice" },
                { col_id: 2, col_type: "text_column", text: "OH" },
              ],
            },
          ],
          has_more: false,
        },
      ],
    });
    const { queryDatabase } = createToolHandlers(client, "g");

    const result = await queryDatabase({ table_name: "Members" });

    const text = result.content[0].text;
    expect(text).toContain('"Members" — 1 row(s) returned');
    expect(text).toContain('"Name": "Alice"');
    expect(text).toContain('"State": "OH"');
    expect(text).toContain('"_row_id": 100');
  });

  it("sends database_id (not table_id) to the getdatabaserows endpoint", async () => {
    const client = fakeClient({
      tables,
      rowPages: [{ data: [], has_more: false }],
    });
    const { queryDatabase } = createToolHandlers(client, "g");

    await queryDatabase({ table_name: "Members" });

    expect(client.apiGet).toHaveBeenCalledWith(
      "getdatabaserows",
      expect.objectContaining({ database_id: 7 }),
    );
    // Verify the old incorrect parameter name is NOT sent
    const callArgs = client.apiGet.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("table_id");
    expect(callArgs).not.toHaveProperty("group_name");
  });

  it("paginates through multiple pages of rows", async () => {
    const client = fakeClient({
      tables,
      rowPages: [
        {
          data: [
            {
              id: 1,
              vals: [{ col_id: 1, col_type: "text_column", text: "Alice" }],
            },
          ],
          has_more: true,
          next_page_token: 55,
        },
        {
          data: [
            {
              id: 2,
              vals: [{ col_id: 1, col_type: "text_column", text: "Bob" }],
            },
          ],
          has_more: false,
        },
      ],
    });
    const { queryDatabase } = createToolHandlers(client, "g");

    const result = await queryDatabase({ table_name: "Members" });

    const text = result.content[0].text;
    expect(text).toContain("2 row(s) returned");
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(client.apiGet).toHaveBeenCalledTimes(2);

    // Second call should include the page_token
    const secondCallParams = client.apiGet.mock.calls[1][1];
    expect(secondCallParams.page_token).toBe(55);
  });

  it("truncates at max_rows and reports truncation", async () => {
    const client = fakeClient({
      tables,
      rowPages: [
        {
          data: [
            { id: 1, vals: [] },
            { id: 2, vals: [] },
          ],
          has_more: true,
          next_page_token: 10,
        },
      ],
    });
    const { queryDatabase } = createToolHandlers(client, "g");

    const result = await queryDatabase({
      table_name: "Members",
      max_rows: 2,
    });

    const text = result.content[0].text;
    expect(text).toContain("2 row(s) returned");
    expect(text).toContain("truncated at max_rows=2");
    // Should not fetch a second page
    expect(client.apiGet).toHaveBeenCalledTimes(1);
  });

  it("requests only the remaining rows needed to hit max_rows", async () => {
    const client = fakeClient({
      tables,
      rowPages: [{ data: [], has_more: false }],
    });
    const { queryDatabase } = createToolHandlers(client, "g");

    await queryDatabase({ table_name: "Members", max_rows: 25 });

    const callParams = client.apiGet.mock.calls[0][1];
    expect(callParams.limit).toBe(25);
  });

  it("caps individual page requests at 100", async () => {
    const client = fakeClient({
      tables,
      rowPages: [{ data: [], has_more: false }],
    });
    const { queryDatabase } = createToolHandlers(client, "g");

    await queryDatabase({ table_name: "Members", max_rows: 200 });

    const callParams = client.apiGet.mock.calls[0][1];
    expect(callParams.limit).toBe(100);
  });
});

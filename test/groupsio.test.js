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

/** Builds a fake client whose fetchAllPages always resolves with the given items. */
function fakeListClient(items) {
  return {
    fetchAllPages: vi.fn().mockResolvedValue(items),
    apiGet: vi.fn().mockResolvedValue({}),
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

// ---------------------------------------------------------------------------
// getGroup
// ---------------------------------------------------------------------------

describe("getGroup", () => {
  /** Fake client whose apiGet is a spy returning fixed group data. */
  function fakeGroupClient(groupData) {
    return {
      fetchAllPages: async () => [],
      apiGet: vi.fn().mockResolvedValue(groupData),
    };
  }

  it("returns formatted group info including name, plan, members, and description", async () => {
    const client = fakeGroupClient({
      name: "MyGroup",
      subs_count: 541,
      plan: "group_plan_premium",
      email: "mygroup@groups.io",
      plain_desc: "Eye some contrast as width yourself stand",
    });
    const { getGroup } = createToolHandlers(client, "MyGroup");

    const result = await getGroup({});

    const text = result.content[0].text;
    expect(text).toContain('Group: "MyGroup"');
    expect(text).toContain("Plan: group_plan_premium");
    expect(text).toContain("Members: 541");
    expect(text).toContain("Eye some contrast as width yourself stand");
  });

  it("calls apiGet with the correct endpoint and resolved group name", async () => {
    const client = fakeGroupClient({
      name: "explicit-group",
      subs_count: 0,
      plan: "free",
      plain_desc: "",
    });
    const { getGroup } = createToolHandlers(client, "default-group");

    await getGroup({ group_name: "explicit-group" });

    expect(client.apiGet).toHaveBeenCalledWith("getgroup", {
      group_name: "explicit-group",
    });
  });

  it("falls back to the default group when group_name is omitted", async () => {
    const client = fakeGroupClient({
      name: "default-group",
      subs_count: 0,
      plan: "free",
      plain_desc: "",
    });
    const { getGroup } = createToolHandlers(client, "default-group");

    await getGroup({});

    expect(client.apiGet).toHaveBeenCalledWith("getgroup", {
      group_name: "default-group",
    });
  });

  it("throws when no group name is available", async () => {
    const client = fakeGroupClient({
      name: "x",
      subs_count: 0,
      plan: "free",
      plain_desc: "",
    });
    const { getGroup } = createToolHandlers(client, undefined);

    await expect(getGroup({})).rejects.toThrow("No group specified");
  });
});

// ---------------------------------------------------------------------------
// getMembers
// ---------------------------------------------------------------------------

describe("getMembers", () => {
  it("returns a formatted list of members with email, full_name, email_delivery, and status", async () => {
    const client = fakeListClient([
      {
        email: "alice@example.com",
        full_name: "Alice Smith",
        email_delivery: "email_delivery_single",
        status: "sub_status_normal",
      },
      {
        email: "bob@example.com",
        full_name: "Bob Jones",
        email_delivery: "email_delivery_digest",
        status: "sub_status_normal",
      },
    ]);
    const { getMembers } = createToolHandlers(client, "testgroup");

    const result = await getMembers({
      group_name: "testgroup",
      type: "members",
    });

    const text = result.content[0].text;
    expect(text).toContain('Members in "testgroup" (members): 2 found');
    expect(text).toContain(
      "alice@example.com | Alice Smith | delivery: email_delivery_single | status: sub_status_normal",
    );
    expect(text).toContain(
      "bob@example.com | Bob Jones | delivery: email_delivery_digest | status: sub_status_normal",
    );
  });

  it("passes the correct group_name and type to fetchAllPages", async () => {
    const client = fakeListClient([]);
    const { getMembers } = createToolHandlers(client, "default-group");

    await getMembers({ group_name: "explicit-group", type: "mods" });

    expect(client.fetchAllPages).toHaveBeenCalledWith("getmembers", {
      group_name: "explicit-group",
      type: "mods",
    });
  });

  it('defaults type to "members" when omitted', async () => {
    const client = fakeListClient([]);
    const { getMembers } = createToolHandlers(client, "testgroup");

    await getMembers({ group_name: "testgroup" });

    expect(client.fetchAllPages).toHaveBeenCalledWith("getmembers", {
      group_name: "testgroup",
      type: "members",
    });
  });

  it("falls back to defaultGroup when group_name is omitted", async () => {
    const client = fakeListClient([]);
    const { getMembers } = createToolHandlers(client, "my-default");

    await getMembers({});

    expect(client.fetchAllPages).toHaveBeenCalledWith("getmembers", {
      group_name: "my-default",
      type: "members",
    });
  });

  it("throws when no group is available", async () => {
    const client = fakeListClient([]);
    const { getMembers } = createToolHandlers(client, undefined);

    await expect(getMembers({})).rejects.toThrow("No group specified");
  });

  it("returns a no-members-found message when the list is empty", async () => {
    const client = fakeListClient([]);
    const { getMembers } = createToolHandlers(client, "testgroup");

    const result = await getMembers({ group_name: "testgroup" });

    expect(result.content[0].text).toContain("No members found.");
  });
});

// ---------------------------------------------------------------------------
// listSubgroups
// ---------------------------------------------------------------------------

describe("listSubgroups", () => {
  it("returns a formatted list of subgroups with name, member count, and description", async () => {
    const client = fakeListClient([
      { name: "alpha", subs_count: 42, plain_desc: "Alpha subgroup" },
      { name: "beta", subs_count: 7, plain_desc: "" },
    ]);
    const { listSubgroups } = createToolHandlers(client, "parentgroup");

    const result = await listSubgroups({ group_name: "parentgroup" });

    const text = result.content[0].text;
    expect(text).toContain('Subgroups in "parentgroup":');
    expect(text).toContain("- alpha | 42 members | Alpha subgroup");
    expect(text).toContain("- beta | 7 members");
  });

  it("omits the description segment when plain_desc is empty", async () => {
    const client = fakeListClient([
      { name: "beta", subs_count: 7, plain_desc: "" },
    ]);
    const { listSubgroups } = createToolHandlers(client, "parentgroup");

    const result = await listSubgroups({ group_name: "parentgroup" });

    expect(result.content[0].text).not.toContain("beta | 7 members |");
  });

  it("calls fetchAllPages with getsubgroups and the resolved group_name", async () => {
    const client = fakeListClient([]);
    const { listSubgroups } = createToolHandlers(client, "default-group");

    await listSubgroups({ group_name: "explicit-group" });

    expect(client.fetchAllPages).toHaveBeenCalledWith("getsubgroups", {
      group_name: "explicit-group",
    });
  });

  it("falls back to defaultGroup when group_name is omitted", async () => {
    const client = fakeListClient([]);
    const { listSubgroups } = createToolHandlers(client, "my-default");

    await listSubgroups({});

    expect(client.fetchAllPages).toHaveBeenCalledWith("getsubgroups", {
      group_name: "my-default",
    });
  });

  it("returns a helpful message when there are no subgroups", async () => {
    const client = fakeListClient([]);
    const { listSubgroups } = createToolHandlers(client, "testgroup");

    const result = await listSubgroups({ group_name: "testgroup" });

    expect(result.content[0].text).toContain("No subgroups");
  });

  it("throws when neither group_name nor defaultGroup is available", async () => {
    const client = fakeListClient([]);
    const { listSubgroups } = createToolHandlers(client, undefined);

    await expect(listSubgroups({})).rejects.toThrow("No group specified");
  });
});

// ---------------------------------------------------------------------------
// getSubscriptions
// ---------------------------------------------------------------------------

describe("getSubscriptions", () => {
  it("returns a formatted list of subscriptions with group_name, group_id, subs_count, email_delivery, and derived role", async () => {
    const client = fakeListClient([
      {
        group_name: "MyGroup",
        group_id: 123,
        subs_count: 541,
        most_recent_message: "2024-01-15",
        mod_status: "sub_modstatus_owner",
        email_delivery: "email_delivery_single",
        status: "sub_status_normal",
      },
      {
        group_name: "AnotherGroup",
        group_id: 456,
        subs_count: 12,
        most_recent_message: "2024-01-10",
        mod_status: "sub_modstatus_none",
        email_delivery: "email_delivery_digest",
        status: "sub_status_normal",
      },
    ]);
    const { getSubscriptions } = createToolHandlers(client, undefined);

    const result = await getSubscriptions({});

    const text = result.content[0].text;
    expect(text).toContain("Subscribed groups: 2");
    expect(text).toContain(
      "- MyGroup (id: 123) | 541 members | delivery: email_delivery_single | role: owner",
    );
    expect(text).toContain(
      "- AnotherGroup (id: 456) | 12 members | delivery: email_delivery_digest | role: member",
    );
  });

  it('calls fetchAllPages with "getsubs" and no group filtering', async () => {
    const client = fakeListClient([]);
    const { getSubscriptions } = createToolHandlers(
      client,
      "some-default-group",
    );

    await getSubscriptions({});

    expect(client.fetchAllPages).toHaveBeenCalledWith("getsubs", {});
  });

  it("correctly derives role from mod_status", async () => {
    const client = fakeListClient([
      {
        group_name: "OwnerGroup",
        group_id: 1,
        subs_count: 10,
        mod_status: "sub_modstatus_owner",
        email_delivery: "email_delivery_single",
        status: "sub_status_normal",
      },
      {
        group_name: "ModGroup",
        group_id: 2,
        subs_count: 20,
        mod_status: "sub_modstatus_moderator",
        email_delivery: "email_delivery_single",
        status: "sub_status_normal",
      },
      {
        group_name: "MemberGroup",
        group_id: 3,
        subs_count: 30,
        mod_status: "sub_modstatus_none",
        email_delivery: "email_delivery_single",
        status: "sub_status_normal",
      },
    ]);
    const { getSubscriptions } = createToolHandlers(client, undefined);

    const result = await getSubscriptions({});

    const text = result.content[0].text;
    expect(text).toContain("role: owner");
    expect(text).toContain("role: moderator");
    expect(text).toContain(
      "- MemberGroup (id: 3) | 30 members | delivery: email_delivery_single | role: member",
    );
  });

  it('returns "Not subscribed to any groups." when the list is empty', async () => {
    const client = fakeListClient([]);
    const { getSubscriptions } = createToolHandlers(client, undefined);

    const result = await getSubscriptions({});

    expect(result.content[0].text).toBe("Not subscribed to any groups.");
  });
});

// ---------------------------------------------------------------------------
// listTopics
// ---------------------------------------------------------------------------

describe("listTopics", () => {
  /** Fake client whose apiGet resolves with the given gettopics page body.
   *  All calls are captured in `apiGetCalls` for assertion without vi.fn(). */
  function fakeTopicsClient(pageBody) {
    const apiGetCalls = [];
    return {
      fetchAllPages: async () => [],
      apiGet: async (...args) => {
        apiGetCalls.push(args);
        return pageBody;
      },
      apiGetCalls,
    };
  }

  it("returns a formatted list of topics with id, subject, message count, and date", async () => {
    const client = fakeTopicsClient({
      data: [
        {
          id: 1001,
          subject: "Hello world",
          num_messages: 5,
          last_post_date: "2024-01-15T10:30:00Z",
        },
        {
          id: 1002,
          subject: "Another topic",
          num_messages: 1,
          last_post_date: "2024-01-14T08:00:00Z",
        },
      ],
      has_more: false,
    });
    const { listTopics } = createToolHandlers(client, "testgroup");

    const result = await listTopics({});

    const text = result.content[0].text;
    expect(text).toContain('Recent topics in "testgroup" (2)');
    expect(text).toContain("[1001] Hello world | 5 msgs | 2024-01-15");
    expect(text).toContain("[1002] Another topic | 1 msg | 2024-01-14");
  });

  it("calls apiGet with gettopics and the resolved group_name", async () => {
    const client = fakeTopicsClient({ data: [], has_more: false });
    const { listTopics } = createToolHandlers(client, "default-group");

    await listTopics({ group_name: "explicit-group" });

    expect(client.apiGetCalls).toHaveLength(1);
    expect(client.apiGetCalls[0]).toEqual([
      "gettopics",
      { group_name: "explicit-group", limit: 20 },
    ]);
  });

  it("falls back to the default group when group_name is omitted", async () => {
    const client = fakeTopicsClient({ data: [], has_more: false });
    const { listTopics } = createToolHandlers(client, "my-default");

    await listTopics({});

    expect(client.apiGetCalls).toHaveLength(1);
    expect(client.apiGetCalls[0]).toEqual([
      "gettopics",
      { group_name: "my-default", limit: 20 },
    ]);
  });

  it("passes limit=50 to the API when requested", async () => {
    const client = fakeTopicsClient({ data: [], has_more: false });
    const { listTopics } = createToolHandlers(client, "g");

    await listTopics({ limit: 50 });

    expect(client.apiGetCalls[0][1].limit).toBe(50);
  });

  it("caps the limit at 100 when a value above 100 is requested", async () => {
    const client = fakeTopicsClient({ data: [], has_more: false });
    const { listTopics } = createToolHandlers(client, "g");

    await listTopics({ limit: 200 });

    expect(client.apiGetCalls[0][1].limit).toBe(100);
  });

  it("returns a helpful message when there are no topics", async () => {
    const client = fakeTopicsClient({ data: [], has_more: false });
    const { listTopics } = createToolHandlers(client, "testgroup");

    const result = await listTopics({});

    expect(result.content[0].text).toBe("No topics found in this group.");
  });

  it("handles topics missing optional fields gracefully", async () => {
    const client = fakeTopicsClient({
      data: [{ id: 99, subject: "Bare topic" }],
      has_more: false,
    });
    const { listTopics } = createToolHandlers(client, "g");

    const result = await listTopics({});

    expect(result.content[0].text).toContain("[99] Bare topic");
    // No extra separators for missing fields
    expect(result.content[0].text).not.toContain("undefined");
  });

  it("throws when no group is available", async () => {
    const client = fakeTopicsClient({ data: [], has_more: false });
    const { listTopics } = createToolHandlers(client, undefined);

    await expect(listTopics({})).rejects.toThrow("No group specified");
  });
});

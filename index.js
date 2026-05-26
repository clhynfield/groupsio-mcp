#!/usr/bin/env node

/**
 * Groups.io MCP Server
 *
 * Thin entry point — all business logic lives in lib.js.
 * This file handles configuration, MCP wiring, and startup.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createApiClient, createToolHandlers } from "./groupsio.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.GROUPSIO_API_KEY;
const DEFAULT_GROUP = process.env.GROUPSIO_GROUP;

if (!API_KEY) {
  process.stderr.write(
    "Error: GROUPSIO_API_KEY environment variable is required.\n",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const client = createApiClient({ apiKey: API_KEY });
const handlers = createToolHandlers(client, DEFAULT_GROUP);

const server = new McpServer({
  name: "groupsio",
  version: "1.0.0",
});

// --- get_group -------------------------------------------------------------

server.tool(
  "get_group",
  "Get settings and info for a Groups.io group: name, plan, member count, email address, and description.",
  {
    group_name: z
      .string()
      .optional()
      .describe(
        `Name of the Groups.io group (e.g. "mygroup" or "mygroup+subgroup"). ` +
          `Defaults to GROUPSIO_GROUP env var if set.`,
      ),
  },
  handlers.getGroup,
);

// --- list_databases ---------------------------------------------------------

server.tool(
  "list_databases",
  "List all database tables available in a Groups.io group.",
  {
    group_name: z
      .string()
      .optional()
      .describe(
        `Name of the Groups.io group (e.g. "mygroup+subgroup" or just "mygroup"). ` +
          `Defaults to GROUPSIO_GROUP env var if set.`,
      ),
  },
  handlers.listDatabases,
);

// --- describe_database ------------------------------------------------------

server.tool(
  "describe_database",
  "Get the column schema for a specific database table in a Groups.io group. " +
    "Use this before querying to understand what fields are available.",
  {
    group_name: z
      .string()
      .optional()
      .describe("Name of the Groups.io group. Defaults to GROUPSIO_GROUP."),
    table_name: z
      .string()
      .optional()
      .describe(
        "Name of the database table to describe. " +
          "Either table_name or table_id is required.",
      ),
    table_id: z
      .number()
      .optional()
      .describe(
        "Numeric ID of the database table. Either table_name or table_id is required.",
      ),
  },
  handlers.describeDatabase,
);

// --- query_database ---------------------------------------------------------

server.tool(
  "query_database",
  "Fetch all rows from a Groups.io database table, returned as structured records " +
    "keyed by column name. Automatically paginates through all data. " +
    "Use this to answer questions about members or any other database content.",
  {
    group_name: z
      .string()
      .optional()
      .describe("Name of the Groups.io group. Defaults to GROUPSIO_GROUP."),
    table_name: z
      .string()
      .optional()
      .describe(
        "Name of the database table to query. Either table_name or table_id is required.",
      ),
    table_id: z
      .number()
      .optional()
      .describe(
        "Numeric ID of the database table. Either table_name or table_id is required.",
      ),
    max_rows: z
      .number()
      .optional()
      .default(500)
      .describe(
        "Maximum number of rows to return. Defaults to 500. " +
          "Increase if you know the table is larger and need complete data.",
      ),
  },
  handlers.queryDatabase,
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

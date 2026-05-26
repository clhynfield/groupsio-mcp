# groupsio-mcp

An MCP server for Groups.io, focused on conversational querying of group databases (member contact lists, directories, etc.).

## Tools

| Tool | Description |
|---|---|
| `list_databases` | List all database tables in a group |
| `describe_database` | Get column schema for a specific table |
| `query_database` | Fetch all rows as structured records, auto-paginated |

The `query_database` tool returns every row as a plain object keyed by column name, making it easy to ask questions like *"who lives in Ohio?"* or *"find everyone whose membership expires this year"*.

## Prerequisites

- Node.js 18+
- A Groups.io API key — create one at https://groups.io/settings/apikeys

## Installation

```bash
git clone <your-repo>
cd groupsio-mcp
npm install
```

## Configuration

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GROUPSIO_API_KEY` | ✅ | Your Groups.io API key |
| `GROUPSIO_GROUP` | optional | Default group name (can be overridden per tool call) |

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "groupsio": {
      "command": "node",
      "args": ["/absolute/path/to/groupsio-mcp/index.js"],
      "env": {
        "GROUPSIO_API_KEY": "your_key_here",
        "GROUPSIO_GROUP": "your-default-group"
      }
    }
  }
}
```

After editing, restart Claude Desktop.

## Usage examples

Once connected, you can ask Claude things like:

- *"List the databases in my group"*
- *"What columns does the Members database have?"*
- *"Query the contacts database and find everyone in Ohio"*
- *"Who in the member directory has a phone number on file?"*
- *"Summarize the membership by state"*

For large databases, increase `max_rows` (default 500) in the tool call if you need complete data.

## Group name format

The `group_name` parameter uses the Groups.io group identifier — typically the part before `@groups.io` in the email address. For subgroups, use the `+` notation: `parentgroup+subgroup`.

## Notes

- The Groups.io API currently exposes two database endpoints: list tables and fetch rows. There is no server-side filtering, so `query_database` fetches all rows and lets the LLM reason over them in context.
- The API is marked ALPHA by Groups.io and subject to change.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for XP practices, TDD workflow, and project conventions.

AI agents (Copilot, Claude, etc.) should also read [AGENTS.md](AGENTS.md) for the ping-pong TDD subagent protocol used in this project.

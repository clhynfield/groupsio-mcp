/**
 * Integration tests — exercise the real Groups.io API.
 *
 * These tests are skipped automatically when GROUPSIO_API_KEY is not set,
 * so `npm test` (unit tests) always works without credentials.
 *
 * Required environment variables (set in .envrc — gitignored):
 *   GROUPSIO_API_KEY    — Groups.io API token
 *   GROUPSIO_GROUP      — group name to run tests against
 *   GROUPSIO_TEST_QUERY — a search term known to return results in that group
 *
 * The suite is skipped automatically if any of these are unset.
 *
 * To run:
 *   npm run test:integration
 *
 * What these tests assert:
 *   - The correct API endpoint name is used (wrong name → non-JSON response → error)
 *   - The correct field names are read (wrong field → undefined in output)
 *   - The output format matches what Claude will actually see
 *
 * What they deliberately do NOT assert:
 *   - Specific message content, subjects, or sender names
 *   - Specific message or topic IDs
 *   - Member counts or group metadata values
 *
 * This keeps personal data out of the source tree while still catching the
 * class of bugs (wrong endpoint, wrong field names) that unit tests miss.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createApiClient, createToolHandlers } from "../groupsio.js";

// ---------------------------------------------------------------------------
// Setup — skip the entire suite if credentials are absent
// ---------------------------------------------------------------------------

const API_KEY = process.env.GROUPSIO_API_KEY;
const GROUP = process.env.GROUPSIO_GROUP;
const SEARCH_TERM = process.env.GROUPSIO_TEST_QUERY;
const skip = !API_KEY || !GROUP || !SEARCH_TERM;

// ---------------------------------------------------------------------------
// Shared client / handlers
// ---------------------------------------------------------------------------

let handlers;

beforeAll(() => {
  if (skip) return;
  const client = createApiClient({ apiKey: API_KEY });
  handlers = createToolHandlers(client, GROUP);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Matches a formatted message line: [<num>] <subject> | from: <name> | YYYY-MM-DD */
const MESSAGE_LINE_RE = /^\[\d+\] .+ \| from: .+ \| \d{4}-\d{2}-\d{2}$/m;

/** Matches a formatted topic line: - [<id>] <subject> */
const TOPIC_LINE_RE = /^- \[\d+\] .+/m;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skip)("integration — live Groups.io API", () => {
  describe("getMessages", () => {
    it("returns formatted message lines with the correct field names", async () => {
      const result = await handlers.getMessages({ limit: 5 });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toMatch(MESSAGE_LINE_RE);
    });
  });

  describe("listTopics", () => {
    it("returns formatted topic lines", async () => {
      const result = await handlers.listTopics({ limit: 5 });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toMatch(TOPIC_LINE_RE);
    });
  });

  describe("getTopicMessages", () => {
    it("returns formatted message lines for a real topic ID", async () => {
      // Get a real topic ID from the group first.
      const topicsResult = await handlers.listTopics({ limit: 1 });
      expect(topicsResult.isError).toBeFalsy();

      const match = topicsResult.content[0].text.match(/\[(\d+)\]/);
      expect(match).not.toBeNull();
      const topicId = Number(match[1]);

      const result = await handlers.getTopicMessages({ topic_id: topicId });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toMatch(MESSAGE_LINE_RE);
    });
  });

  describe("getMessage", () => {
    it("returns a formatted message header with the correct field names", async () => {
      // Get a real message number from the group.
      const messagesResult = await handlers.getMessages({ limit: 1 });
      expect(messagesResult.isError).toBeFalsy();

      const match = messagesResult.content[0].text.match(/^\[(\d+)\]/m);
      expect(match).not.toBeNull();
      const msgNum = Number(match[1]);

      const result = await handlers.getMessage({ msg_num: msgNum });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Header lines must be present and non-empty.
      expect(text).toMatch(/^Subject: .+/m);
      expect(text).toMatch(/^From: .+/m);
      expect(text).toMatch(/^Date: \d{4}-\d{2}-\d{2}$/m);
    });
  });

  describe("searchArchives", () => {
    it("returns formatted message lines for a broad search term", async () => {
      const result = await handlers.searchArchives({ q: SEARCH_TERM, limit: 5 });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toMatch(MESSAGE_LINE_RE);
    });
  });
});

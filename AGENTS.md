# Agent Guidelines

Instructions for AI coding agents (Copilot, Claude, Zed Agent, etc.) working
in this repository. Read this before making any changes.

---

## Project at a Glance

| Item | Detail |
|---|---|
| **Runtime** | Node.js 18+, ES modules (`"type": "module"`) |
| **Test runner** | Vitest — `npm test` to run once, `npm run test:watch` to watch |
| **Business logic** | `groupsio.js` — all exported functions, pure where possible |
| **MCP wiring** | `index.js` — thin; no logic lives here |
| **Tests** | `test/groupsio.test.js` — no network, no env vars; use injected fakes |
| **Dependencies** | `@modelcontextprotocol/sdk`, `zod`; devDep: `vitest` |

All production code uses injectable dependencies (pass `fetchFn`, `client`,
etc. as parameters) so tests never touch the network. New code should follow
the same pattern.

---

## Guiding Principles

This project follows XP practices — see `CONTRIBUTING.md` for the full
picture. The rules that most affect agent behaviour:

1. **TDD is non-negotiable.** No production code without a failing test first.
2. **Smallest possible step.** Implement exactly what the failing test demands,
   nothing more.
3. **Green suite is a hard gate.** Never leave a failing test behind.
4. **Refactor under green.** Only restructure when all tests pass.
5. **Inject, don't import side-effects.** Keep functions pure and testable.

---

## Ping-Pong TDD with Subagents

For any non-trivial feature, the orchestrating agent should run three
sequential subagent turns — one for each phase of the TDD cycle. This keeps
the phases strictly separated and mirrors human ping-pong pairing.

```
Orchestrator
    │
    ├─► Red Agent    — writes the failing test
    │        │ hands off: test file diff + confirmed failure output
    │
    ├─► Green Agent  — writes minimum implementation to pass
    │        │ hands off: implementation diff + confirmed pass output
    │
    └─► Refactor Agent — cleans up under green
             │ hands off: refactored diff + confirmed pass output
```

### When to use this pattern

- Adding a new exported function or a new code path through an existing one.
- Fixing a bug (the Red agent first writes a test that reproduces the bug).
- Any change where the right design is not yet obvious — let tests drive it.

For trivial mechanical changes (renaming a variable, updating a string
constant, fixing a typo), a single agent turn is fine.

---

### Red Agent — "Write the Failing Test"

**Goal:** Add one or more focused `it(...)` blocks that specify the desired
behaviour. Run the suite. Confirm the new test(s) fail and only the new
test(s) fail.

**Prompt template for the orchestrator to use:**

```
You are the Red agent in a TDD ping-pong cycle.

## Your only job
Add a failing test (or tests) to `test/groupsio.test.js` that specifies
the following behaviour:

  <FEATURE DESCRIPTION>

## Rules
- Write the test(s) first. Do NOT touch `groupsio.js` or `index.js`.
- Use Vitest `describe`/`it`/`expect`. Follow the existing style in the
  test file (plain object fakes, no mocking frameworks).
- The test must fail for the right reason — a missing export, a wrong
  return value, or an unhandled case — not because of a syntax error or
  import issue.
- Run `npm test` and confirm: the new test(s) fail; all pre-existing tests
  still pass.
- Return: the exact diff you applied, the relevant lines of test output
  showing the failure, and a one-sentence summary of what the test asserts.
```

**Hand-off to Green:** The Red agent's output (diff + failure snippet) becomes
the Green agent's input.

---

### Green Agent — "Make It Pass"

**Goal:** Write the minimum production code that turns the red test green.
Nothing more. No refactoring yet.

**Prompt template:**

```
You are the Green agent in a TDD ping-pong cycle.

## Context
The Red agent just added this failing test:

  <PASTE RED AGENT'S TEST DIFF>

Failure output:
  <PASTE FAILURE SNIPPET>

## Your only job
Edit `groupsio.js` (and only `groupsio.js`) to make the failing test(s)
pass with the minimum code change.

## Rules
- Do not touch `test/groupsio.test.js`.
- Do not touch `index.js`.
- Write only enough code to satisfy the failing test — no speculative
  abstractions, no future-proofing.
- Preserve the injectable-dependency style: no hard-coded `fetch`, no
  `process.env` reads inside business logic.
- Run `npm test` and confirm the full suite is green.
- Return: the exact diff you applied and the test output showing all tests
  passing.
```

**Hand-off to Refactor:** Green agent's output (diff + passing output)
becomes the Refactor agent's input.

---

### Refactor Agent — "Clean It Up"

**Goal:** Improve the structure, names, and clarity of both the implementation
and the tests without changing any behaviour. The suite must be green before
and after.

**Prompt template:**

```
You are the Refactor agent in a TDD ping-pong cycle.

## Context
The Green agent just made these tests pass:

  <PASTE GREEN AGENT'S DIFF>

All tests are currently green.

## Your job
Refactor the implementation in `groupsio.js` and/or the test in
`test/groupsio.test.js` to improve clarity, remove duplication, or
simplify structure. You may touch both files.

## Rules
- Do NOT change observable behaviour. The test assertions must remain
  semantically identical (you may reword descriptions but not weaken them).
- Run `npm test` before and after your changes. Both runs must be fully
  green.
- Common things to look for:
    - Duplicated setup that could become a shared helper or `beforeEach`
    - Names that don't communicate intent
    - Functions that do more than one thing
    - Magic numbers or strings that deserve a named constant
    - Dead code introduced during the green phase
- If nothing needs improving, say so explicitly. Unnecessary refactors are
  worse than none.
- Return: the diff (or "no changes needed"), and the test output confirming
  the suite is still green.
```

---

## What Every Agent Must Do

Regardless of which phase you are in:

1. **Read `CONTRIBUTING.md`** before making any change.
2. **Run `npm test` and confirm it is green** before starting work. If it is
   not, report that and stop.
3. **Do not introduce new dependencies** without explicit human approval.
4. **Do not edit `index.js`** unless the task is specifically about MCP
   wiring.
5. **Do not make unrelated changes.** Scope your diff to exactly what your
   phase requires.
6. **Report test output.** Always include the relevant lines of `npm test`
   output in your response so the orchestrator can verify the outcome.

---

## Fake / Stub Conventions

This project uses plain JS objects and functions as test doubles — no
`vi.mock`, no `sinon`, no `jest.fn`. Follow these patterns:

```js
// A fake fetch that returns a fixed response
function fakeFetch(responseData) {
  return async () => ({
    ok: true,
    json: async () => responseData,
  });
}

// A fake client with controlled responses
function fakeClient({ tables = [], rowPages = [] } = {}) {
  let rowPageIndex = 0;
  return {
    fetchAllPages: async () => tables,
    apiGet: async () => {
      const page = rowPages[rowPageIndex++] ?? { data: [], has_more: false };
      return page;
    },
  };
}
```

Introduce new fake helpers at the top of the describe block that needs them,
or alongside the existing `fakeFetch`/`fakeClient` helpers if they are broadly
useful.

---

## Validation Checklist (for any agent, any phase)

- [ ] `npm test` is green before my changes
- [ ] My diff is scoped to the correct file(s) for this phase
- [ ] `npm test` is green after my changes
- [ ] I have not introduced new dependencies or side-effects
- [ ] I have included relevant test output in my response

# Contributing

This project follows Extreme Programming (XP) practices as embodied by teams
like [Test Double][td] and [Pivotal Labs][pl]. The short version: work in tiny 
slices, let tests drive the design, and always ask "does this deliver customer 
value right now?"

[td]: https://testdouble.com (Test Double)
[pl]: https://pivotal.fun/codex (Pivotal Labs)

---

## Core Values

| Value | What it means here |
|---|---|
| **Communication** | Code is a conversation. Names, tests, and commit messages should explain *why*, not just *what*. |
| **Simplicity** | Build the simplest thing that could possibly work. Delete code as aggressively as you add it. |
| **Feedback** | Tests, CI, and real users give you feedback. Listen to all three, and shorten the loop to each. |
| **Courage** | Refactor mercilessly. Delete dead code. Change a bad design before it calcifies. |
| **Respect** | Leave every file, test, and interface better than you found it. |

---

## Practices

### Test-Driven Development (TDD)

Follow the strict red-green-refactor cycle. No production code without a
failing test that demands it.

1. **Red** — Write the smallest test that describes the next desired behaviour.
   Run the suite; confirm this test (and only this test) fails.
2. **Green** — Write the minimum implementation to make the test pass. Don't
   optimise, don't abstract — just go green.
3. **Refactor** — With the safety net of a green suite, clean up both the
   implementation and the test. Remove duplication. Improve names. Then run
   the suite again.

Repeat. The cycle should take minutes, not hours.

**Tests are first-class code.** Treat them with the same care as production
code: good names, no duplication, clear assertions.

### Small Iterations

Break every feature into the smallest possible vertical slice that is
independently deployable and provides observable customer value. A good story
fits inside a single pairing session (≤ 2 hours). If it doesn't, split it.

Commit frequently — at minimum after every green cycle. Small commits make
review trivial and rollback safe.

### Customer Value First

Before writing any code, ask:

- *Who benefits from this change?*
- *What is the smallest version of this that delivers that benefit?*
- *Can we validate the value without building it at all?*

Prefer a working, minimal feature over an elaborate, unverified one. Ship, then
iterate.

### Simple Design (YAGNI + DTSTTCPW)

> "You Aren't Gonna Need It" and "Do The Simplest Thing That Could Possibly Work"

- No speculative abstractions. Generalise only when the third concrete case
  appears.
- Prefer pure functions and injectable dependencies over global state and
  hard-coded side-effects. (This codebase already demonstrates both: see
  `groupsio.js`.)
- Delete commented-out code. If it matters, git history has it.

### Collective Code Ownership

No one owns a file. Anyone (human or AI) can change any part of the codebase
at any time, as long as the tests pass and the change is reviewed.

### Continuous Integration

- `npm test` must pass on every commit pushed to `main`.
- Never commit with a red suite. If you must, push to a branch and open a
  draft PR clearly marked as work-in-progress.
- Keep the test run fast enough that you run it automatically, not reluctantly.

### Refactoring

Refactor continuously — not in dedicated "cleanup sprints". The rule:

> If you touch a file, leave it cleaner than you found it.

Refactoring means changing structure without changing behaviour. A full green
suite before and after is the definition of a safe refactor.

---

## Project Conventions

| Convention | Detail |
|---|---|
| **Language** | Node.js 18+, ES modules (`import`/`export`) |
| **Test runner** | [Vitest](https://vitest.dev) — `npm test` or `npm run test:watch` |
| **Business logic** | Lives in `groupsio.js`; injectable deps for testability |
| **MCP wiring** | Thin layer in `index.js`; keep it free of logic |
| **No mocking frameworks** | Inject fakes directly (plain functions / objects) |
| **Assertions** | Vitest `expect` — prefer specific matchers over `toBeTruthy` |

### Keeping the README current

`README.md` is the first thing a new user or integrator reads. Update it in
the same PR as any change that affects:

- The available tools (names, descriptions, parameters)
- Environment variables or configuration
- Installation or setup steps
- Usage examples or behavioural defaults

A feature that works but isn't documented hasn't fully shipped.

### What a good PR looks like

- Title is a single, present-tense sentence describing the customer-visible
  change.
- Description links to the story/issue and explains *why*, not *how*.
- The diff is small enough to review in one sitting (aim for < 200 lines
  changed).
- All new behaviour is covered by new tests; all existing tests still pass.
- `README.md` is updated if any user-facing behaviour changed.
- No unrelated changes bundled in.

---

## Running the tests

```bash
npm test            # single run
npm run test:watch  # re-run on every file save
```

All tests live in `test/groupsio.test.js`. They use plain dependency injection
— no network calls, no environment variables required.

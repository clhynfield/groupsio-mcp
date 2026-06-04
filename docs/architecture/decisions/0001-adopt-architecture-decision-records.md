# ADR 0001 — Adopt Architecture Decision Records

| Field   | Value |
|---------|-------|
| Status  | Accepted |
| Date    | 2026-06-04 |

## Context

This project uses an AI-assisted, agentic development workflow. Agents are
capable of proposing and implementing structural changes quickly — sometimes
faster than human reviewers can evaluate them. Several forces make that
combination risky without a deliberate gate:

**Hard-to-reverse decisions accumulate silently.** Choices about transport
protocols, API contracts, dependency boundaries, and data shapes are easy to
make and costly to undo. Without a written record of the constraints and
trade-offs that shaped a decision, future contributors (human or AI) will
re-litigate it uninformed, or worse, silently reverse it.

**Peer review of architectural changes is structurally different from code
review.** A code reviewer can evaluate whether an implementation is correct
given a direction. Evaluating whether the direction itself is appropriate
requires a different conversation — one that happens before the code exists,
not after.

**Agentic AI development warrants careful adoption.** AI agents can act at
speed and scale that outpaces the review bandwidth of small teams. Before
expanding agent autonomy (new capabilities, new tool categories, new
integration points), the team needs a lightweight mechanism for pausing,
examining, and explicitly accepting the decision rather than discovering it
in a diff.

## Decision

Adopt **Lightweight Architecture Decision Records** (LADRs), as described by
Michael Nygard in [*Documenting Architecture Decisions*][nygard] and
recommended by the [ThoughtWorks Technology Radar][twradar].

Records live in `docs/architecture/decisions/`, named
`NNNN-short-title.md` and numbered sequentially. Any architecturally
significant change **must** begin with an ADR in **Draft** status and be
reviewed and accepted before test or implementation code is written or
modified.

The lifecycle is:

| Status     | Meaning |
|------------|---------|
| Draft      | Proposed; under discussion. No implementation work yet. |
| Accepted   | Approved; guides current implementation. |
| Deprecated | Still implemented but no longer recommended for new work. |
| Superseded | Replaced by a later ADR (link it). |

ADRs are immutable once Accepted. Changes to a prior decision produce a new
ADR that supersedes the old one; the old record is updated only to add the
"Superseded by ADR NNNN" note.

## Consequences

- Every significant structural decision has a written record of its context,
  rationale, and known trade-offs — legible to future contributors regardless
  of whether they were present for the discussion.
- Architectural changes in agentic workflows go through an explicit review
  gate. An agent that identifies a needed architectural change must draft an
  ADR and stop, rather than proceeding to implementation unilaterally.
- The overhead is intentionally small: a short Markdown file with free-form
  prose. The discipline is in the *sequence* (write first, implement after),
  not the volume of documentation.
- Accepted ADRs accumulate as a navigable history of why the project looks
  the way it does.

## References

- Michael Nygard, [*Documenting Architecture Decisions*][nygard] (2011) —
  the original lightweight format this project follows.
- Software Improvement Group, [*Using Architecture Decision Records to Guide
  Your Architecture Choice*][sig] — practical guidance on ADR adoption.
- ThoughtWorks Technology Radar, [*Lightweight Architecture Decision
  Records*][twradar] — industry endorsement and overview.

[nygard]: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
[sig]: https://www.softwareimprovementgroup.com/blog/using-architecture-decision-records-to-guide-your-architecture-choice/
[twradar]: https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records

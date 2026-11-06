# Next plan: apply the Haiku and effort defaults, then let the weekly review tune them

Planning package: docs/planning/planning-package.json

## Goal

Brian, 2026-11-06 on code2-workspace #162: "why dont we just update that now across sessions and haiku in some places also and the reaosnign level and we should eawrn the ebst rpactics on this bth form resarch and first rprinciples and set upa feedback ssystme so ti improves over time". Subagent routing in this fork should send mechanical work to Haiku, keep design and review off it, cap reasoning effort per tier from the evidence, show the main conversation's cost, and improve from its own outcomes.

## Already done (this branch, merged with PR #1's pace mode)

1. Tier table and effort caps in `hooks/lib/pricing.ts` (easy low, medium on prompts over about 50k tokens; normal medium; hard high; long unchanged). Source: Brian's words above for "haiku in some places" and "the reaosnign level"; the values are inferred by agent from the research report, sections 1.2 and 5.
2. Judging agents never reach Haiku, even under pace or rate-limit pressure (`judgeRoleOf`, `PRESSURE_FLOOR.judge`). Source: inferred by agent, research report section 4.
3. Report fixes in code2-workspace PR #179: a main-conversation line and no false redo for a planned round.
4. Outcome per run and a Monday weekly review that proposes tier-rule changes as recorded decisions (`scripts/router_report.py`, `scripts/router_review.py`, timer `router-review.timer`).
5. README records that the main-model lever is the settings default plus `/model` (a plugin cannot change it).

## Next steps (in order)

1. Merge this branch through `ship`; PR #1 (pace mode) is contained in it and closes as merged.
2. After the first full week of runs under the new rules (week of 2026-11-09), read `weekly/2026-W46.md`. For each proposed decision, read the listed transcripts, then accept or reject it and record which (Q1, Q2, Q5).
3. Done 2026-11-06: the Anthropic pages still say what the Haiku rules rest on (Q3), and no plugin mechanism sets the main model (Q4); evidence is in the ledger.
4. Keep the main-model lever manual (settings default plus `/model`); revisit only if the hooks reference gains a way to set the session model.

## Domain concepts this plan relies on

tier, effort-cap, judging-agent, pressure, classifier-verdict, outcome-signal, weekly-review, tier-decision, main-conversation-line, redo.

## Cost basis

The plan adds no model call of its own. The router already runs one Haiku 5.5 classifier call per new task key at subagent start (`hooks/register.tsx:494`); the report and review scripts make no model call. The classifier figure is a worked-out estimate, not a measurement: 1 call, at most about 2,100 input tokens (the 2,187-character rubric plus a task cut at 6,000 characters, at a guessed 4 characters per token), 48 output tokens, at Haiku 5.5's $0.10 in and $0.50 out per million (`hooks/lib/pricing.ts:9`), no cached share: about $0.00023 per new task key. The 4 characters per token ratio is a guess; the logs do not record classifier calls, so there is no measured figure.

Cheapest design that still does the job: a rubric inside the one existing Haiku call plus constants in `pricing.ts`; no second model, no learned router. The research found learned routers often fail to beat a fixed baseline (research-routing-best-practices.md:73) and signals that need no learning (role, check cost, blast radius) are safer.

## Full-trace visibility

Each routed agent's transcript path is a column in `~/projects/data/logs/router/<day>.tsv`; the weekly review lists the transcripts of every bad run and of runs behind each proposed decision. A session reads those transcripts, a sample of ordinary runs as well as every failure, before accepting a decision.

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
3. Re-read the two Anthropic pages behind the Haiku rules and compare the numbers (Q3).
4. Grep the unread tail of the hooks and model-config pages for a way to set the main model (Q4); change README "Limits" if one exists.

## Domain concepts this plan relies on

tier, effort-cap, judging-agent, pressure, classifier-verdict, outcome-signal, weekly-review, tier-decision, main-conversation-line, redo.

## Cost basis

The plan adds no model call of its own. The router already runs one Haiku 5.5 classifier call per new task key at subagent start (`hooks/register.tsx:494`); the report and review scripts make no model call. The classifier's per-call figure is a guess until `llm-cost` or the 2026-11-05 report's claude-haiku-5-5 row ($0.37 across both columns) is divided by the number of classifications, which the logs do not record.

Cheapest design that still does the job: a rubric inside the one existing Haiku call plus constants in `pricing.ts`; no second model, no learned router. The research found learned routers often fail to beat a fixed baseline (research-routing-best-practices.md:73) and signals that need no learning (role, check cost, blast radius) are safer.

## Full-trace visibility

Each routed agent's transcript path is a column in `~/projects/data/logs/router/<day>.tsv`; the weekly review lists the transcripts of every bad run and of runs behind each proposed decision. A session reads those transcripts, a sample of ordinary runs as well as every failure, before accepting a decision.

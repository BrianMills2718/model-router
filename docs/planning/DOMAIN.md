# model-router glossary

One entry per concept in `domain.graph.json`. "Code" is where the repository implements it; "Source" is where the concept comes from.

| Term | Definition | Code | Source |
| --- | --- | --- | --- |
| subagent | A helper session Claude Code starts for one task; the only thing the router can route. Not implemented here. | none (Claude Code) | README.md:77, research-routing-best-practices.md section 1.3 |
| main-conversation | The session Brian types into. A plugin cannot change its model or effort. Not implemented here. | none (Claude Code) | research-routing-best-practices.md section 1.4 |
| main-model-lever | The two things that do set the main model: the `model` default in `~/.claude/settings.json` and `/model` or `/effort`. Not implemented here. | none (settings) | README.md:77 |
| tier | One of easy, normal, hard, long: the router's grade for a task, each tied to a model. | hooks/lib/pricing.ts:22 | README.md:17-22 |
| effort-cap | The most reasoning effort a tier's requests may ask for; only ever lowers. | hooks/lib/pricing.ts:53 | README.md:19-22 |
| role | A router agent kind (architect, builder, runner, fixer) or the judge group, each with tier limits. | hooks/lib/pricing.ts:180 | README.md:26 |
| judging-agent | An agent whose output is a plan, review or answer someone relies on, so a wrong result is silent. Never on Haiku. | hooks/lib/pricing.ts:196 | README.md:32 |
| risk-floor | A task whose agent will do lasting harm runs on Opus or higher. | hooks/lib/pricing.ts:275 | README.md:27 |
| pressure | Rules that push routing one or two tiers cheaper: rate limit, pace, budget. | hooks/lib/pricing.ts:245 | README.md:28-31 |
| classifier-verdict | Haiku 5.5's tier and risk reading of a task, cached by task key. | hooks/lib/pricing.ts:396 | README.md:35 |
| rescue | A stuck Haiku or Sonnet agent moves up one model mid-run. | hooks/register.tsx:264 | README.md:29 |
| daily-report | One row per subagent run and per main-conversation session, with tier and outcome, plus a short summary. | /home/brian/code2/workspace/scripts/router_report.py:425 | docs/planning/evidence/router-report-2026-11-05.md |
| main-conversation-line | The report line giving the Opus share of main spend and the Sonnet-equivalent cost. | /home/brian/code2/workspace/scripts/router_report.py:358 | code2-workspace #162, critic comment 2026-11-06 |
| outcome-signal | The label on a run: ok, failed_tools, rescued, redone, fixed_after. Catches loud failure only. | /home/brian/code2/workspace/scripts/router_report.py:309 | README.md:87-89 |
| redo | A stronger model repeating the same task text; a planned "round N" is not one. | /home/brian/code2/workspace/scripts/router_report.py:277 | code2-workspace #162, critic comment 2026-11-06 |
| weekly-review | A Monday job that groups outcomes by agent type and tier and proposes tier-rule changes. | /home/brian/code2/workspace/scripts/router_review.py:113 | README.md:87-89 |
| tier-decision | A proposed change to a tier rule, with evidence, traces to read and a status; accepted or rejected by a session. | /home/brian/code2/workspace/scripts/router_review.py:63 | docs/planning/evidence/router-weekly-review-sample.md |

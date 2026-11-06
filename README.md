# model-router

A Claude Code mod that picks a model for each subagent and shows what it cost.

## Install

```
/plugin install model-router --marketplace aott33/model-router
```

Needs Claude Code 2.1.287+. For development: `claude --plugin-dir ./model-router`.

## How it routes

Haiku 5.5 reads each subagent's task and picks a tier:

| Tier | Model | Effort | For |
| --- | --- | --- | --- |
| easy | Haiku 5.5 | low (medium when the prompt is over about 50k tokens) | mechanical fan-out with a cheap check: renames, searches, log or test-output summaries, running tests, version bumps |
| normal | Sonnet 5.5 | medium at most | feature work, plans, reviews, fixes with a known failure |
| hard | Opus 5.5 | high at most | unknown-cause or racy bugs, security, design trade-offs |
| long | Fable 5.1 | unchanged | work the task says is long or unattended |

Why these defaults: Anthropic's own test of Haiku subagents under Opus saved 32% of cost for about 4 points of pass rate, which lowering effort buys too, so effort is tuned first and Haiku is kept to work whose result a cheap check can verify. At low effort in a long prompt Haiku 5.5 is more likely to skip a search or a check, hence medium there. Opus at high rather than xhigh or max: those are for long-horizon work where evals show a gain. Source: Brian, 2026-11-06 on code2-workspace #162 ("haiku in some places also and the reaosnign level"); the per-tier values are inferred by agent from the research report `model-routing-best-practices-20261106.md` (sections 1.2 and 5).

Rules on top:

- **Roles.** Adds four agents: `architect` (plans, Sonnet+), `builder`, `runner` (runs commands, Sonnet max) and `fixer` (Sonnet+).
- **Risk floor.** A task whose agent will do lasting harm (deploy to prod, delete real data, force-push) runs on Opus or higher. Writing such code doesn't count.
- **Rate limits.** At 80% of your 5-hour or weekly limit, routing goes one tier cheaper. Builders and fixers stay on Sonnet or higher.
- **Rescue.** A Haiku or Sonnet agent that is stuck (3 failed tool calls in a row, or far too many requests or minutes) moves up one model mid-run.
- **Pace.** With `pace` on, a 5h or 7d window used faster than its time has passed routes one tier cheaper at 1.25x pace and two tiers at 2x, so the weekly limit lasts until it resets. Same floors as limit pressure; the stronger of the two rules wins.
- **Budget.** With a session budget set, routing goes one tier cheaper at 80% and to the cheapest allowed model at 100%. Risky tasks still get Opus.
- **Judging agents never get Haiku.** Any agent type named architect, Plan, reviewer, code-review, project-brain, researcher or ending in `-reviewer` runs on Sonnet or higher, and pace or rate-limit pressure cannot push it below Sonnet. A wrong approval or plan is a silent error. Source: inferred by agent (research report section 4); Brian: "design, review and anything Brian reads" stay off Haiku.
- **Effort** is only ever lowered, never raised.
- **Left alone:** models Claude names, forks, workflow agents and teammates.

If Haiku doesn't answer, the engine's classifier tries, then the role's default. Verdicts are cached, so a repeated task skips the classifier.

## Commands

| Command | Does |
| --- | --- |
| `/router` | open the pane |
| `/router off` | stop routing |
| `/router haiku`, `sonnet`, `opus` | send every routed agent to one model |
| `/router on` | route again |
| `/router status` | show the mode |
| `/router reset` | clear the bill |

The mode is kept across sessions.

## The pane

- **Header:** spent, unrouted cost and savings, rate-limit and budget gauges, the last turn's receipt, and Claude Code's own total.
- **Table:** each agent's status (`◐` running, `✓` done), tier, model, time, cost and unrouted cost.
- **Why:** press `ctrl+x tab`, then an agent's number, to see why it got its model. `Esc` returns to the prompt.
- **Marks:** `!` risky, `↓` lowered for rate limits or budget, `↑` rescued. Dim rows weren't routed.

A band above the prompt shows each running agent; a status line shows the total.

## Settings (`/config`)

| Setting | Default | |
| --- | --- | --- |
| Open the pane at start | on | off: only `/router` opens it |
| Compare against | `unrouted` | price the unrouted column on what each agent would have used, or on `fable`, `opus`, `sonnet` |
| Route every subagent | on | off: only the four router agents |
| Keep a model Claude asked for | on | |
| Lower effort for easy tasks | on | |
| Send risky tasks to Opus | on | |
| Move up a struggling agent | on | |
| Route cheaper near rate limits | `80` | `70`, `90` or `off` |
| Route cheaper when ahead of pace | `off` | `on` |
| Session budget | `off` | $1, $2, $5, $10, $20 or $50 |

## Limits

- Only subagents are routed. The main conversation keeps your model. A plugin cannot change the main session's model or effort (research report section 1.4); the levers are the `model` default in `~/.claude/settings.json` (set to sonnet) and `/model` or `/effort` mid-session. Main conversations were $506 of $1,031 on 2026-11-05, $450 of it Opus, so that default matters more than any subagent rule. The daily report has a main-conversation line showing the Opus share and what the same tokens cost on Sonnet.
- Dollar figures use API list prices. On Pro or Max they're API-equivalent; the real saving is rate-limit headroom.
- "Saved" assumes the same tokens on another model, so it's an estimate.
- A rescue re-reads the agent's context at the new model's price.
- The risk flag is a judgment call. It doesn't replace permission prompts.
- Explore's own model is learned only from runs it wasn't routed.
- Model ids and prices live in `hooks/lib/pricing.ts`.

## Feedback loop

The router keeps no log of its own. The daily report (`scripts/router_report.py` in code2-workspace, written to `~/projects/data/logs/router/<day>.tsv`) gives every subagent run a `tier` and an `outcome`: `ok`, `failed_tools`, `rescued`, `redone` (a stronger model repeated the task) or `fixed_after` (a fixer started within 30 minutes). `scripts/router_review.py` runs Mondays at 07:50 and writes `~/projects/data/logs/router/weekly/<week>.md` with proposed tier-rule changes as recorded decisions (raise at 10+ runs and 12%+ bad outcomes; lower at 30+ runs and under 3%, never for judging agents). A session reads it, checks the sampled traces, and accepts or rejects each decision. A clean week is weak evidence: the signals catch loud failure only.

## Develop

```
claude plugin validate .
claude plugin test .
```

See `RELEASING.md` and `CHANGELOG.md`.

## Credits

Clock, gauge and receipt ideas from [claude-flightdeck](https://github.com/scasella/claude-flightdeck) (MIT).

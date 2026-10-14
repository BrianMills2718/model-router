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
| easy | Haiku 5.5 | low | renames, searches, running tests |
| normal | Sonnet 5.5 | medium at most | feature work, plans, fixes with a known failure |
| hard | Opus 5.5 | unchanged | unknown-cause or racy bugs, security, design trade-offs |
| long | Fable 5.1 | unchanged | work the task says is long or unattended |

Rules on top:

- **Roles.** Adds four agents: `architect` (plans, Sonnet+), `builder`, `runner` (runs commands, Sonnet max) and `fixer` (Sonnet+).
- **Risk floor.** A task whose agent will do lasting harm (deploy to prod, delete real data, force-push) runs on Opus or higher. Writing such code doesn't count.
- **Rate limits.** At 80% of your 5-hour or weekly limit, routing goes one tier cheaper. Builders and fixers stay on Sonnet or higher.
- **Rescue.** A Haiku or Sonnet agent that is stuck (3 failed tool calls in a row, or far too many requests or minutes) moves up one model mid-run.
- **Budget.** With a session budget set, routing goes one tier cheaper at 80% and to the cheapest allowed model at 100%. Risky tasks still get Opus.
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
| Compare against | `unrouted` | price the unrouted column on what each agent would have used, or on `fable`, `opus`, `sonnet` |
| Route every subagent | on | off: only the four router agents |
| Keep a model Claude asked for | on | |
| Lower effort for easy tasks | on | |
| Send risky tasks to Opus | on | |
| Move up a struggling agent | on | |
| Route cheaper near rate limits | `80` | `70`, `90` or `off` |
| Session budget | `off` | $1, $2, $5, $10, $20 or $50 |

## Limits

- Only subagents are routed. The main conversation keeps your model.
- Dollar figures use API list prices. On Pro or Max they're API-equivalent; the real saving is rate-limit headroom.
- "Saved" assumes the same tokens on another model, so it's an estimate.
- A rescue re-reads the agent's context at the new model's price.
- The risk flag is a judgment call. It doesn't replace permission prompts.
- Explore's own model is learned only from runs it wasn't routed.
- Model ids and prices live in `hooks/lib/pricing.ts`.

## Develop

```
claude plugin validate .
claude plugin test .
```

See `RELEASING.md` and `CHANGELOG.md`.

## Credits

Clock, gauge and receipt ideas from [claude-flightdeck](https://github.com/scasella/claude-flightdeck) (MIT).

# Model routing (code2-workspace #162): plan package

Status: plan only, not implemented. Source: Brian, 2026-11-06 01:45: "why dont we just update that now across sessions and haiku in some places also and the reaosnign level ... set upa feedback ssystme so ti improves over time". Issue: BrianMills2718/code2-workspace#162.

## Facts this plan rests on (read 2026-11-07)

- The router routes only subagents. The README "Limits" section says: "Only subagents are routed. The main conversation keeps your model. A plugin cannot change the main session's model or effort" (`README.md`, Limits). Claude Code's `PreModelSwitch` hook can only allow, deny or ask about a switch.
- Diagnosis (session 47ef359b, 2026-11-05, from the issue): the main conversation ran on Opus for 1,223 replies. Six mechanical subagents ran on Opus because `routeAll` was off and no model was set per call. After the fix, builders ran on Sonnet.
- The router has an effort table (`effortByTier`) and settings for "Lower effort for easy tasks", "Send risky tasks to Opus", "Move up a struggling agent", and cheaper routing near rate limits (`README.md`, settings table).
- The levers for the main conversation are the `model` default in `~/.claude/settings.json` (already set to sonnet) and `/model` or `/effort` mid-session (`README.md`, Limits). Main conversations were $514 of $1,056 on 2026-11-05, and $454 of that was Opus (88%) (`README.md`, Limits; the router's own daily report, measured by its author, not re-derived here). So the main-conversation default matters more than the subagent rules.
- Fork: `BrianMills2718/model-router`. Its open pull request #1 (pace mode) is blocked on this plan.

## What is decided and what is not

Decided by the facts above, not by a test:
- A plugin cannot set the main conversation's model. Item 1 of the issue therefore becomes a **suggestion**, not a switch: a hook shows the recommended main model and reasoning level for the task at session start, and the user switches with `/model`. Setting it automatically is not possible with the current hooks.
- Only subagents can be set per call, so the Haiku tier and the reasoning level apply there.

Not decided (needs evidence before a default changes):
- Which subagent jobs go to Haiku. Working default: mechanical fan-out (search, inventory, per-item fills, runners) on Haiku; anything that decides, designs or reviews stays on Sonnet or Opus.
- Reasoning level per tier. Working default: keep the router's current `effortByTier` values until the feedback loop has data.

## Cost basis

Every cost figure here is a guess until the feedback loop measures it. The router's own dollar figures use API list prices and are estimates ("'Saved' assumes the same tokens on another model", README). No new cost figure is claimed in this plan.

## Plan

1. **Main-conversation suggestion (hook).** Add a session-start hook that reads the task (issue, branch, first prompt) and prints a one-line suggestion: model and effort, with the reason. No switching. Check first: does the hook get the prompt text? If not, suggest from the working directory and branch only.
2. **Haiku tier.** Write the tier rule as a table: job type → tier, with a "never Haiku" list (design, review, decisions Brian reads). Start with the mechanical list only.
3. **Reasoning level.** Keep `effortByTier` as is. Change a value only after the feedback loop shows a retry or correction rate for that tier and task.
4. **Best-practice check.** Read Anthropic's model-choice and effort guidance and any published routing studies; record each source with its date and the exact claim it supports. Cite, do not paraphrase from memory.
5. **Feedback loop.** `router_report.py` adds an outcome per routed task: retries, whether a fixer ran after the agent, and Brian's corrections (from the feedback log). A weekly review adjusts the tier table and records each change as a decision with the evidence line.
6. **Planning package for the fork.** This file plus the checks that prove each step: step 1 on a sample of sessions; steps 2–3 on the existing router report; step 5 on one week of data.

## Checks (how we know each step worked)

- Step 1: the suggestion is printed on at least one real session start, and the trace records the input it used.
- Steps 2–3: `router_report.py` shows the tier chosen for each routed subagent, and the count of mechanical jobs that ran on Opus is zero after the change.
- Step 5: the weekly review lists each tier change with its evidence and the outcome data it used.

Every check prints its counts and exit status.

## Open questions

- Q1 (Brian): is a suggestion at session start enough, or do you want the hook to block a main-model choice that is clearly too expensive? Default: suggestion only, since blocking is not possible for the main model.
- Q2: how is "Brian's correction" recorded in the feedback log, so the loop can count it? Default: the existing `learned` feedback lines, tagged with the task.

## Not in this plan

- No change to the router's code. This is the plan package only; implementation waits for Brian's go.

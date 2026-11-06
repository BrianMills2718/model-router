# Model and effort routing for Claude Code: best practices (code2-workspace #162)

Compiled 2026-11-06. Evidence is tagged **[direct]** (read from the source this session) or **[inference]** (my reading). Models: Opus 5.5, Sonnet 5.5, Haiku 5.5. Fable 5.1 also exists and the model-router README routes to it for "long" work.

## 0. Bottom line

1. Anthropic's own advice: tune effort first, add a second model only if cost per completed task beats the single model's whole score-vs-spend curve on your workload.
2. A plugin or hook cannot change the main session's model or effort. Only the user's `/model` and `/effort`, `--model`, and settings or env can. Hooks can only block, confirm, or observe a switch. Subagents are the only routable surface.
3. Published routers save a lot on in-distribution benchmarks, but independent evidence shows they often fail to beat a simple fixed-model baseline, and they degrade out of distribution. Signals that need no learning (role, verifiability, blast radius) are safer than a learned router.
4. Anthropic's measured Haiku-subagents-under-Opus test saved 32% cost but lost about 4 points of pass rate, roughly what lowering effort gives. Effort is the cheaper lever.
5. Cheap model where a cheap check exists (tests, grep results, compile). Strong model where errors are silent (design, root-cause debugging, security, review).

## 1. Anthropic guidance

### 1.1 Choosing a model

- "Choosing the right model" (platform.claude.com, undated page, current as of fetch 2026-11-06): https://platform.claude.com/docs/en/about-claude/models/choosing-a-model **[direct]**
  - Table: Fable 5.1 = highest capability, hours-long agent sessions. Opus 5.5 = complex agentic coding, large refactors, systems engineering. Sonnet 5.5 = "everyday coding, agent, and enterprise workloads", code generation, agentic tool use. Haiku 5.5 = "lowest latency and price", high-volume, cost-sensitive, "subagent tasks".
  - "Tuning effort is often a better lever than switching models."
  - Two starting strategies: efficiency-first (start on Haiku, upgrade only for specific gaps) and capability-first (start on Opus, then lower effort or model once evals hold). "Having a good evaluation set is the most important step."
- Claude Code model config (https://code.claude.com/docs/en/model-config, fetched 2026-11-06) **[direct]** aliases: `opus` = "complex reasoning tasks", `sonnet` = "daily coding tasks", `haiku` = "simple tasks", `opusplan` = Opus in plan mode then Sonnet for execution, `fable` = hardest and longest-running.
- Optimizing for cost and intelligence (https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence, fetched 2026-11-06; only first ~100k chars read) **[direct]**:
  - Orchestrator pattern: Opus 5.5 orchestrating Sonnet 5.5 subagents matched Opus alone at `medium` for about one third less cost, on defect search larger than one context window.
  - Haiku subagents under Opus 5.5 at `medium` on a coding benchmark: cost per attempt down 32%, pass rate down about 4 points (95% interval 1.3 to 7.1), "roughly what mixing low and medium without subagents gives, so it was not better than lowering effort."
  - Delegation won only for (a) routine work with a long cost tail and (b) work larger than one context window. Dependent chains and single-context work were better on one model at lower effort.
  - Haiku 5.5 suits "high-volume, latency-sensitive work with checkable outputs" (GPQA Diamond 85% vs 91% for Opus 5.5 and Sonnet 5.5, about 1/20 of Opus cost per correct answer).
  - Advisor pattern (cheap executor, Fable 5.1 advisor) gave +1.7 points at about 2.1x cost on Anthropic's agentic-coding benchmark, "at the edge of run-to-run noise". It only helps if the executor actually consults, and consultation collapsed at lower effort in one pairing.
  - "Price the tail": on one run, 2 of 20 problems carried 43% of spend.

### 1.2 Effort

Source: https://platform.claude.com/docs/en/build-with-claude/effort (fetched 2026-11-06) **[direct]**

| Level | Anthropic's description |
| --- | --- |
| low | Most efficient, "some capability reduction". For "simpler tasks that need the best speed and lowest costs, such as subagents" |
| medium | Opus 5.5 and Haiku 5.5 default. For Sonnet 5.5: start at `medium` for well-specified agentic coding and multistep tool use, `high` for harder or longer |
| high | Complex reasoning, difficult coding, agentic tasks |
| xhigh / max | Long-horizon work (over 30 min); "only where your evals show a quality gain" |

- Haiku 5.5: start at `medium`, including agentic coding. At `low` in long agent prompts "the model is more likely to skip a search, stop early, or skip a check." This is a silent-error risk for the `easy -> Haiku low` rule on long tasks.
- Changing top-level effort between requests invalidates the prompt cache. Hold effort constant within a cached conversation, or use per-message effort (beta; Opus 5.5 supports it). Relevant to a rescue or mid-run change.
- Discrepancy to be aware of: the platform effort page says Sonnet 5.5 defaults to `high` on the API, while Claude Code docs say the Claude Code default for Opus 5.5, Sonnet 5.5, Haiku 5.5 is `medium`. In Claude Code, "medium at most" for Sonnet is therefore the default, not a saving.

### 1.3 Subagents in Claude Code

Source: https://code.claude.com/docs/en/sub-agents (fetched 2026-11-06) **[direct]**

- Model resolution order: per-invocation `model` param (aliases only) > subagent frontmatter `model` (`inherit` allowed) > `CLAUDE_CODE_SUBAGENT_MODEL` > main conversation's model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces one model on all.
- `effort` frontmatter overrides session effort but not `CLAUDE_CODE_EFFORT_LEVEL`. On a different model from the main one, the session's effort "doesn't apply", so set it explicitly.
- Docs give a cost rationale ("routing tasks to faster, lower-cost models like Haiku", e.g. read-only search) but no tiered rule.
- Use the main conversation for iterative work, shared context across phases, quick targeted changes. Subagents for verbose output and self-contained tasks.
- Built-in helper `claude-code-guide` uses Haiku, `statusline-setup` uses Sonnet. Explore, Plan, general-purpose follow the main model (Explore has an Opus special case when main is Fable).

### 1.4 Can a plugin or hook change the main session model mid-session?

Short answer: **no**, as far as the docs show. **[direct, with a coverage gap]**

- `/model <name>` switches immediately; `Enter` in the picker saves as default, `s` is session-only. Highest precedence of all sources. Effort changes apply from the next message.
- `PreModelSwitch` hook (https://code.claude.com/docs/en/hooks): can allow, deny, or ask about a switch the user or a client requested; cannot substitute a different model. `PostModelSwitch` is context-only (`additionalContext`).
- Effort is read-only to hooks (`effort.level`, `$CLAUDE_EFFORT`); no output field sets it. No `$CLAUDE_MODEL`; `$ANTHROPIC_MODEL` does not update after `/model`.
- Hook output fields that exist: `additionalContext`, `updatedInput` (PreToolUse), `updatedToolOutput`, `decision`/`reason`, `systemMessage`, etc. None set the session model.
- Agent SDK has `setModel()` for programmatic hosts (model-config page). That is for SDK apps, not plugins in the interactive CLI.
- Gaps: I read only the first ~100k of 288k chars of the hooks reference and 100k of 131k of model-config. The SessionStart env-persistence mechanism was not covered. Before relying on "impossible", grep the unread tail for `setModel`, `model` in settings-in-hook output, and `CLAUDE_ENV_FILE`. Even if SessionStart can set env, `ANTHROPIC_MODEL` only applies at startup per the docs.
- Practical implication **[inference]**: the main session can only be steered by (a) advice injected via `additionalContext` ("this looks like a trivial task, consider /model sonnet"), (b) user habit (`opusplan`, `/model`, `/effort`), or (c) delegating work to routed subagents. The main-session model is also inherited by `inherit` subagents, so a user running main on Opus makes every unrouted subagent Opus.

## 2. Published evidence on LLM routing

| Source (date) | Finding | Caveat |
| --- | --- | --- |
| RouteLLM, Ong et al., arXiv 2406.18665 (v1 2024-06-26, v4 2025-02-23); blog https://lmsys.org/blog/2024-07-01-routellm/ (2024-07-01) **[direct]** | Cost down over 85% (MT Bench), 45% (MMLU), 35% (GSM8K) vs GPT-4 only, at 95% of GPT-4 quality. Best router: 26% of calls to strong model on MT Bench (14% with judge-augmented data). Routers transferred to Claude 3 Opus / Llama 3 8B without retraining | MMLU with arena data only: near random (out of distribution). With about 1.5k golden labels, 54% strong calls were needed, only about 14% cheaper. Chat-style prompts, not agent trajectories |
| FrugalGPT, Chen et al., arXiv 2305.05176 (2023-05-09) **[direct]** | Cascade (cheap first, escalate if a scorer is not confident) matches best single LLM with up to 98% cost reduction, or +4% accuracy at equal cost | Needs a reliable answer-quality scorer. Short QA tasks, 2023 models |
| LLMRouterBench, arXiv 2601.07206 (Jan 2026, ACL 2026 Findings) **[direct via search summary; paper not opened]** | 400k+ instances, 21 datasets, 33 models, 10 routers. Many recent routers, including commercial ones, do not reliably beat a simple best-single-model baseline. Large gap to an oracle remains; failures are mostly "model recall" (picking the one model that is right) | Authors' own benchmark, no independent replication seen |
| Anthropic orchestrator test (above, 1.1) **[direct]** | Haiku workers: 32% cheaper, about 4 pts lower pass rate. Same as just lowering effort | Single internal benchmark |

What signals work, synthesized **[inference from the above plus Anthropic's pages]**:

- Strong: whether a cheap verifier exists for the output (cascade works only with a trustworthy check, per FrugalGPT); task size relative to context window; role in the workflow; blast radius.
- Weaker: a learned or LLM-judged "difficulty" score. It works in distribution and fails out of it; recall failures dominate the oracle gap. Haiku reading a task and guessing a tier is this weaker class, so keep the rules around it (risk floor, role floors, rescue) doing the heavy lifting.
- Cascades (escalate on observed failure) beat up-front prediction when failure is observable. The router's "rescue" rule is this. Its trigger (3 failed tool calls) catches loud failure, not a wrong-but-confident answer.
- Anthropic's own finding that routing to cheaper models roughly equals lowering effort means a router that mostly lowers effort on the same model keeps the cache and context, with less risk.

## 3. Practitioner reports (lower evidence grade: blogs, mostly not measured)

- Start Debugging, 2026-10-28, https://startdebugging.net/2026/10/claude-haiku-5-5-vs-sonnet-5-5-vs-opus-5-5-for-coding-agent-subagents/ (AI-assisted post; cites figures from Anthropic) **[direct]**:
  - Core rule: pick the model by what happens when the subagent is wrong, not how hard the task looks.
  - Roles: main/orchestrator Opus 5.5 medium; implementer Sonnet 5.5 medium (high if long or vague); reviewer/verifier Sonnet 5.5 high (Opus for security or concurrency); explorer and log/CI/test triage Haiku 5.5 low or medium.
  - Cites Terminal-Bench 4.0: Haiku 5.5 39.2% vs Sonnet 5.5 70.6%; do not let Haiku edit code unsupervised. Mechanical edits (rename, add import, bump version) are fine. I did not verify these benchmark numbers against Anthropic's model pages.
- Search roundup (dev.to, Medium, guides, 2026): consistent pattern of Haiku for read-only search/summaries/log triage, Sonnet for implementation and review, Opus for planning and the main session. Opus is said to burn quota roughly 3x Sonnet. One critic notes "opus is smart, haiku is cheap" is intuition, not data. **[search summary only; not independently opened, unverified]**
- Not found: any measured report comparing small vs large models on debugging or review in Claude Code. The "design, debugging, review need bigger models" claim rests on Anthropic's task descriptions for Opus ("complex reasoning", "systems engineering") and on reasoning in section 4, not on a controlled study. Treat as moderately supported.

## 4. First principles

Expected cost of a task:

    E[cost] = price(model) x tokens(model, effort)
              + P(wrong result) x C(detect + redo)

- Tokens differ by model and effort: a weaker model often uses more turns, and `low` effort can skip checks (Haiku 5.5 docs). A cheap model with 2x the turns erodes a 5-20x price gap less than expected, but rarely erases it.
- C(detect + redo) is dominated by detection. If a cheap check exists (tests, typecheck, grep count, exit code, diff review of a small change), C is small and bounded, so the cheap model wins even at a high error rate. This is the FrugalGPT/cascade condition.
- If errors are silent (plausible but wrong root cause, design flaw, missed vulnerability, review that approves bad code, a summary that omits the key file), P(wrong) is multiplied by a large and unbounded C, including downstream work built on the wrong result. Pay for the strong model, and often for higher effort rather than a bigger model.
- Context redo is not free: a rescue re-reads context at the new model's price and, if effort changes, can invalidate cache.
- Weekly limit angle: In the Start Debugging post's 60k-token example (per 20 requests: Haiku $0.04, Sonnet $0.66, Opus $1.32), Opus is about 2x Sonnet and Sonnet is about 16x Haiku, so the Sonnet-to-Haiku step saves far more than Opus-to-Sonnet (figures not verified against Anthropic's price page). Subscription limits are not priced identically to API; verify the real burn rate with the router's own logs before tuning.
- Tail effect: a few hard tasks carry most spend. Savings come from the bulk of routine work, so a router must not degrade the tail.

## 5. Recommendation table (subagents; main session is manual)

| Task type | Model | Reasoning | Why |
| --- | --- | --- | --- |
| Codebase search, file/symbol lookup, summarising logs or test output | Haiku 5.5 | low; medium if prompt is long (over ~50k tokens) or answer must be exhaustive | Read-only, output checkable by the parent, Anthropic lists as subagent task. Low skips searches in long prompts |
| Run tests/lint/build, report pass/fail | Haiku 5.5 (Sonnet if it must interpret failures) | low | Exit code is the check. Interpretation of a failure is where silent error starts |
| Mechanical edits (rename, import, version bump, formatting) | Haiku 5.5 | low-medium | Diff plus compile/tests catches errors cheaply. Do not allow multi-file semantic change |
| Well-specified feature or fix with known failure and tests | Sonnet 5.5 | medium | Anthropic: medium for well-specified agentic coding |
| Vague or long implementation, multi-file, unfamiliar code | Sonnet 5.5 | high | Anthropic: high for harder or longer. Cheaper than moving to Opus |
| Planning/architecture for a contained change | Sonnet 5.5 (Opus if cross-cutting) | high | A wrong plan misleads everything after. Errors are silent until late |
| Code review, verification of another agent's work | Sonnet 5.5 high; Opus 5.5 for security, concurrency, data-loss paths | high | Silent-error class: approving bad code. Reviewer should not be weaker than the author |
| Unknown-cause, racy, or intermittent bug; root-cause analysis | Opus 5.5 | high (xhigh/max only if high fails) | No cheap check on a diagnosis. Cost of a wrong cause is large |
| Security, auth, migrations, prod deploy, destructive commands | Opus 5.5 | high | Risk floor: irreversible or silent harm |
| Design trade-offs, API/schema decisions | Opus 5.5 | high | Judgment tasks with no verifier |
| Hours-long unattended work | Opus 5.5 (Fable 5.1 only if evals show gain) | high-xhigh | Anthropic: Fable gains were within noise at 2-3x cost |
| Many independent pieces larger than one context | Opus orchestrator + Sonnet workers | medium | The one case where Anthropic measured a clear delegation saving (about 1/3) |

Router-rule observations **[inference]**:

- Haiku low for "easy" is fine for search and test runs, but add a long-prompt exception, or use medium.
- "Hard: effort unchanged" means Opus 5.5 runs at `medium` in Claude Code by default. If a hard task is wrong-answer-sensitive, set `high` explicitly via subagent `effort`, since the router otherwise inherits medium.
- Under weekly-limit pressure, lower effort on the same model before lowering the model for review and diagnosis tasks.
- The README's tiers are named easy/normal/hard/long; the issue text says simple/standard/hard. Align naming in logs.

## 6. Outcome signals to log per routed task

Log with task id, role, tier chosen, model, effort, classifier verdict and confidence, and whether the verdict was cached.

1. **Verification outcome:** did a cheap check pass after the agent returned (tests, build, typecheck, lint exit codes) and on first attempt? Fail rate by tier and model is the core quality signal.
2. **Escalation and rescue events:** rescue fired (which trigger: 3 failed tool calls, request count, minutes), manual `/router opus`, or the parent re-delegating the same task to a bigger model. Target: rescue rate low but non-zero. Zero suggests over-provisioning, high suggests under-provisioning.
3. **Rework downstream:** within the next N turns, did the parent or user undo, re-edit, or contradict the agent's output (reverted diff, same files edited again, a "that's wrong" prompt, or a follow-up fix agent)? This is the only proxy for silent errors.
4. **Cost and token ratio:** actual cost, turns, tokens, wall time versus the unrouted estimate; also tokens-per-task by model, to detect the weak-model-uses-more-turns effect. Include weekly-limit percent consumed per task, since that is the real budget.
5. **Risk and floor hits:** whether the risk floor or limit/pace downshift applied (the `!` and down-arrow marks), and incidents on downshifted tasks (outcome 1 or 3 failures with a downshift mark). This tells you whether pace mode costs quality.

Review loop **[inference]**: weekly, compute outcome 1 and 3 failure rates per (role, tier, model, effort). Promote a rule up a tier where failure is above a threshold you set (suggest 10-15% to start, adjust). Demote where failure is under about 3% over 30+ samples and cost saving is material. Sample a few verdicts for human grading, since Haiku's tier choice is the weakest-evidence part of the system.

## 7. Source list

- https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
- https://platform.claude.com/docs/en/build-with-claude/effort
- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/hooks
- https://arxiv.org/abs/2406.18665 (RouteLLM) and https://lmsys.org/blog/2024-07-01-routellm/
- https://arxiv.org/abs/2305.05176 (FrugalGPT)
- https://arxiv.org/abs/2601.07206 (LLMRouterBench; summary via search, paper not opened)
- https://startdebugging.net/2026/10/claude-haiku-5-5-vs-sonnet-5-5-vs-opus-5-5-for-coding-agent-subagents/
- Local: /home/brian/code2/model-router/README.md

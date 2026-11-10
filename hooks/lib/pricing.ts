import type { Tier, Tokens } from '../../types'

/** USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing (Oct 2026). */
export type Price = { input: number; output: number; cacheWrite: number; cacheRead: number }

export const PRICES: Record<'haiku4' | 'haiku5' | 'sonnet' | 'opus' | 'fable', Price> = {
  haiku4: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  // Prompts up to 100,000 tokens; HAIKU5_LONG above that.
  haiku5: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  sonnet: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  opus: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  fable: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
}

/** Haiku 5.5 for a prompt (input, cache reads and cache writes together) over 100,000 tokens. */
export const HAIKU5_LONG: Price = { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 }
export const HAIKU5_LONG_FROM = 100_000

export type Family = keyof typeof PRICES

/** Full model ids the router spawns on. */
export const MODEL_FOR_TIER: Record<Tier, string> = {
  simple: 'claude-haiku-5-5',
  standard: 'claude-sonnet-5-5',
  hard: 'claude-opus-5-5',
  long: 'claude-fable-5-1',
}

/**
 * The classifier: Haiku 5.5 at low effort. In a live run it answered all eight test tasks
 * in one word each, at a seventh of Haiku 4.5's cost, and placed a small feature as
 * standard where Haiku 4.5 said simple.
 */
export const CLASSIFIER_MODEL = 'claude-haiku-5-5'
export const CLASSIFIER_EFFORT = 'low' as const

/**
 * How long a request's cache writes live. Claude Code writes the main conversation's
 * prompt cache for an hour (2x input) and a subagent's for five minutes (1.25x input):
 * pricing them so matched its own session cost to the cent in a live run.
 */
export type CacheTtl = '5m' | '1h'

export const ORDER: Tier[] = ['simple', 'standard', 'hard', 'long']

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * The most reasoning effort a routed agent's requests may ask for, by tier. Easy work
 * thinks less; hard and long work keep whatever the session would have used.
 */
export const EFFORT_CAP: Record<Tier, Effort | undefined> = {
  simple: 'low',
  standard: 'medium',
  hard: 'high',
  long: undefined,
}

/**
 * A prompt this long (about 50k tokens) lifts Haiku's cap from low to medium: Anthropic says
 * at low in long agent prompts Haiku 5.5 "is more likely to skip a search, stop early, or skip a check".
 * Source: inferred by agent from the Haiku 5.5 effort guidance (#162 research, section 1.2).
 */
export const LONG_PROMPT_CHARS = 200_000

/** The cap for a tier, given the size of the prompt the agent starts with. */
export function effortCapFor(tier: Tier, promptChars = 0): Effort | undefined {
  if (tier === 'simple' && promptChars > LONG_PROMPT_CHARS) return 'medium'
  return EFFORT_CAP[tier]
}

/**
 * The lower of a request's effort and the cap. An integer budget or a level this
 * table does not know is left alone, as is a request without effort.
 */
export function capEffort<E>(effort: E, cap: Effort | undefined): E | Effort {
  if (!cap || typeof effort !== 'string') return effort
  const i = EFFORTS.indexOf(effort as Effort)
  return i < 0 || i <= EFFORTS.indexOf(cap) ? effort : cap
}

/** `/router` modes: `on` classifies, `off` leaves every spawn alone, a model name sends every routed spawn there. */
export type Mode = 'on' | 'off' | 'haiku' | 'sonnet' | 'opus'
export const MODES: Mode[] = ['on', 'off', 'haiku', 'sonnet', 'opus']

export function parseMode(text: unknown): Mode | undefined {
  const m = String(text ?? '').trim().toLowerCase()
  return (MODES as string[]).includes(m) ? (m as Mode) : undefined
}

export const FORCED_TIER: Record<Exclude<Mode, 'on' | 'off'>, Tier> = {
  haiku: 'simple',
  sonnet: 'standard',
  opus: 'hard',
}

/**
 * Which price row a model id or alias falls in. Mythos bills as Fable.
 * A bare `haiku` alias is the current Haiku (5.5). Unknown ids price as Opus.
 */
export function familyOf(model: string | undefined): Family {
  const m = (model ?? '').toLowerCase()
  if (m.includes('haiku')) return /haiku-[34]/.test(m) ? 'haiku4' : 'haiku5'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('fable') || m.includes('mythos')) return 'fable'
  return 'opus'
}

const FAMILY_TIER: Record<Family, Tier> = {
  haiku4: 'simple',
  haiku5: 'simple',
  sonnet: 'standard',
  opus: 'hard',
  fable: 'long',
}

/** The tier a model belongs to, for a model Claude named itself. */
export function tierOfModel(model: string): Tier {
  return FAMILY_TIER[familyOf(model)]
}

/** True for a request whose prompt (input, cache reads and cache writes) is over Haiku 5.5's threshold. */
export function isLongPrompt(t: Tokens): boolean {
  return t.input + t.cacheRead + t.cacheWrite > HAIKU5_LONG_FROM
}

/**
 * Cost of a request's tokens on a family. Haiku 5.5 switches price above a 100K-token prompt,
 * judged per request: `long` says which side the request fell on, else it is read off `t`.
 * Summed tokens must be split by `isLongPrompt` first, or the sum crosses the threshold and
 * everything is priced at the higher rate. Cache writes cost 1.25x input for 5 minutes, 2x
 * for an hour.
 */
export function costOf(t: Tokens, family: Family, ttl: CacheTtl = '5m', long = isLongPrompt(t)): number {
  const p = family === 'haiku5' && long ? HAIKU5_LONG : PRICES[family]
  const write = ttl === '1h' ? p.input * 2 : p.cacheWrite
  return (t.input * p.input + t.output * p.output + t.cacheWrite * write + t.cacheRead * p.cacheRead) / 1e6
}

export function tokensFromUsage(u: {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}): Tokens {
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  }
}

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

export function subTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input - b.input,
    output: a.output - b.output,
    cacheRead: a.cacheRead - b.cacheRead,
    cacheWrite: a.cacheWrite - b.cacheWrite,
  }
}

export const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Role guard rails, applied after Haiku's answer.
 * runner never goes above standard (running tests is not Opus work).
 * architect and fixer never go below standard (a bad plan or a bad fix costs more than the tokens).
 */
export const ROLE_LIMITS: Record<string, { min?: Tier; max?: Tier; fallback: Tier }> = {
  architect: { min: 'standard', fallback: 'hard' },
  builder: { fallback: 'standard' },
  runner: { max: 'standard', fallback: 'simple' },
  fixer: { min: 'standard', fallback: 'standard' },
  // Agents that judge, review or design (any plugin's): never Haiku. A wrong approval or plan is silent.
  judge: { min: 'standard', fallback: 'standard' },
}

/**
 * Agent types whose output is a judgment or a design, so errors are silent and no cheap check
 * catches them. They get the `judge` limits: Haiku never, whoever installed them.
 * Matched on the agent type's name (an identifier), not on task prose.
 * Source: Brian, 2026-11-06 on #162: "haiku in some places"; design, review and anything he reads
 * stay off Haiku is inferred by agent from the research (silent-error class, section 4).
 */
const JUDGE_TYPES = new Set(['architect', 'plan', 'reviewer', 'code-review', 'project-brain', 'researcher'])
export function judgeRoleOf(agentType: string): string | undefined {
  const name = (agentType.split(':').pop() ?? '').toLowerCase()
  return JUDGE_TYPES.has(name) || name.endsWith('-reviewer') ? 'judge' : undefined
}

const DEF_TIER: Record<string, Tier> = { haiku: 'simple', sonnet: 'standard', opus: 'hard' }

/** The tier an agent definition's frontmatter `model:` names (haiku, sonnet, opus or a full id), else undefined. */
export function definitionModelTier(text: string): Tier | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return undefined
  const line = /^model:\s*['"]?([\w.-]+)/m.exec(m[1]!)
  if (!line) return undefined
  const v = line[1]!.toLowerCase()
  const fam = Object.keys(DEF_TIER).find(k => v === k || v.includes(`-${k}-`) || v.startsWith(`${k}-`) || v.includes(k))
  return fam ? DEF_TIER[fam] : undefined
}

/**
 * The lowest tier a judging agent runs on while usage is on pace (no pace, rate-limit or budget step):
 * its own definition's model, else Opus for a reviewer (`reviewer` or `*-reviewer`). Under pressure
 * the judge floor is Sonnet (PRESSURE_FLOOR). Undefined for agents that do not judge.
 * Source: Brian, 2026-11-07 (harness presentation): "judges stay on Opus at level 0 with a Sonnet floor";
 * tools row target: "take the judge floor from the agent definition (Opus for reviewer and planning reviewers)".
 */
export function judgeFloor(agentType: string, definition?: string): Tier | undefined {
  if (judgeRoleOf(agentType) !== 'judge') return undefined
  const fromDef = definition ? definitionModelTier(definition) : undefined
  if (fromDef) return fromDef
  const name = (agentType.split(':').pop() ?? '').toLowerCase()
  return name === 'reviewer' || name.endsWith('-reviewer') ? 'hard' : undefined
}

export function roleOf(agentType: string): string | undefined {
  const m = /^model-router:(\w+)$/.exec(agentType)
  return m ? m[1] : undefined
}

/**
 * The role's limits, then `long` only when allowed: a task that does not ask for
 * long-running or unattended work goes to Opus, never to Fable at 2.5 times the price.
 */
export function clampTier(tier: Tier, role: string | undefined, allowLong = true): Tier {
  let i = ORDER.indexOf(tier)
  const lim = role ? ROLE_LIMITS[role] : undefined
  if (lim?.min) i = Math.max(i, ORDER.indexOf(lim.min))
  if (lim?.max) i = Math.min(i, ORDER.indexOf(lim.max))
  if (!allowLong) i = Math.min(i, ORDER.indexOf('hard'))
  return ORDER[i]!
}

/**
 * Words that ask for a long or unattended run. Narrow on purpose: the Agent tool runs
 * agents in the background by default, so "in the background" says nothing about length.
 */
const LONG_RUN =
  /(?<!\bin\s+the\s+)\blong[- ]?run(ning)?\b|\bunattended\b|\bovernight\b|\bmulti[- ]?hours?\b|\bfor\s+((several|many|a\s+few|\d+)\s+)?hours\b|\bhours[- ]long\b|\bautonomously\b|\bkeep\s+(going|working|running)\s+until\b/i

/** True when the task itself asks for long-running or unattended work: the only way to `long`. */
export function asksForLongRun(text: string): boolean {
  return LONG_RUN.test(text)
}

/**
 * The tier after the risk floor and rate-limit pressure.
 *
 * Under pressure (a rate-limit window past the threshold) the tier drops one step and
 * `long` is off the table; the role's limits still hold. A risky task then goes to at
 * least `hard`, past a role's cap too: getting a destructive act wrong costs more than
 * the tokens, so the risk floor wins over pressure.
 */
/**
 * How low rate-limit pressure may push a role that writes code. A builder or fixer moved
 * from Sonnet to Haiku stalled for 56 minutes on a subtle bug in a live run; easy work the
 * classifier already put on Haiku stays there.
 */
export const PRESSURE_FLOOR: Record<string, Tier> = { builder: 'standard', fixer: 'standard', judge: 'standard' }

export function routeTier(
  tier: Tier,
  role: string | undefined,
  allowLong: boolean,
  o: { risky?: boolean; underPressure?: boolean; cheapest?: boolean; down?: number; judgeMin?: Tier } = {},
): Tier {
  // The budget is spent: the cheapest tier the role allows. Only the risk floor goes higher.
  if (o.cheapest) {
    const t = clampTier('simple', role, false)
    return o.risky && ORDER.indexOf(t) < ORDER.indexOf('hard') ? 'hard' : t
  }
  const i = ORDER.indexOf(tier)
  const floor = role && PRESSURE_FLOOR[role] ? Math.min(i, ORDER.indexOf(PRESSURE_FLOOR[role]!)) : 0
  // `down` is how many tiers to drop (pace); `underPressure` is the one-tier rule.
  const down = Math.max(o.down ?? 0, o.underPressure ? 1 : 0)
  let t = clampTier(down > 0 ? ORDER[Math.max(floor, i - down)]! : tier, role, allowLong && down === 0)
  // A judge's own floor holds only while nothing pushes routing down; then PRESSURE_FLOOR (Sonnet) applies.
  if (role === 'judge' && o.judgeMin && down === 0 && ORDER.indexOf(t) < ORDER.indexOf(o.judgeMin)) t = o.judgeMin
  if (o.risky && ORDER.indexOf(t) < ORDER.indexOf('hard')) t = 'hard'
  return t
}

/**
 * Destructive acts, for when no classifier answered. Narrow on purpose: it names the act
 * (deploying to production, dropping a table, a forced push), not the subject, so code
 * that merely deals with payments or databases does not match.
 */
const RISKY_ACT =
  /\b(deploy|ship|release|roll\s?out)\w*\b[^.\n]{0,40}\b(to|on|in)\s+(prod|production|live)\b|\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b|\brm\s+-rf\s+\/|\bgit\s+push\s+(-f|--force)\b|\bforce[- ]push\b|\b(delete|wipe|purge)\b[^.\n]{0,30}\b(prod|production)\s+(data|database|db|bucket|users?)\b/i

/**
 * Agent types that only read and report, so the task's subject (a public push, a deploy) is not an act
 * the agent performs. The risk floor never applies to them; their own definition's model holds.
 * Matched on the agent type's name, not on task prose.
 * Source: Brian, 2026-11-05: publish checks belong on Sonnet (22 of 28 had run on Opus); code2-workspace #282:
 * the classifier called a publish check "risky" because the brief said the repository was about to go public.
 */
const READ_ONLY_TYPES = new Set(['publish-checker'])
export function readOnlyAgent(agentType: string): boolean {
  return READ_ONLY_TYPES.has((agentType.split(':').pop() ?? '').toLowerCase())
}

export function looksRisky(text: string): boolean {
  return RISKY_ACT.test(text)
}

const TIER_RE = /\b(simple|standard|hard|long)\b/i
/** `risky` not negated: "not risky", "no risky flag", "non-risky" and "never risky" do not count. */
const RISKY_RE = /(?<!\b(?:not|no|non|never|isn'?t|without)[\s-]+)\brisky\b/i

function trimmedLines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean)
}

/** The index of the last line that names a tier, or -1. */
function lastTierLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (TIER_RE.test(lines[i]!)) return i
  return -1
}

/**
 * The classifier's verdict: the last line that names a tier. Haiku sometimes explains before
 * or after it, and the explanation can name other tiers or say "not risky"; a reply cut off
 * before any tier word has no verdict.
 */
function verdictLine(text: string): string {
  const lines = trimmedLines(text)
  const at = lastTierLine(lines)
  return at >= 0 ? lines[at]! : ''
}

/**
 * Reads the classifier's risk flag: an unnegated `risky` on the verdict line or after it
 * ("hard risky", or "hard" then "risky: deploys to production"); false without a verdict.
 */
export function parseRisky(text: string): boolean {
  const lines = trimmedLines(text)
  const at = lastTierLine(lines)
  return at >= 0 && RISKY_RE.test(lines.slice(at).join('\n'))
}

/** The fullest rate-limit window, in percent; 0 off a subscription or before the first reading. */
export function fullestWindow(limits: readonly { percentUsed: number }[] | undefined): number {
  return (limits ?? []).reduce((m, l) => Math.max(m, l.percentUsed), 0)
}

/** Window lengths the pace rule knows; other kinds are skipped. */
const PACE_WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
/** The least "expected use" a pace ratio divides by, so a window's first minutes don't explode it. */
export const PACE_MIN_EXPECTED = 5
/** Ahead-of-pace ratios at which routing goes one and two tiers cheaper. */
export const PACE_ONE_DOWN = 1.25
export const PACE_TWO_DOWN = 2

export type Pace = {
  kind: string
  percentUsed: number
  /** Share of the window elapsed, in percent. */
  expected: number
  ratio: number
  /** Tiers to drop: 0, 1 or 2. */
  steps: 0 | 1 | 2
}

/** The pace of one rate-limit window; undefined without a usable `resetsAt`, for an unknown kind, or once it has passed. */
export function paceOf(l: { kind: string; percentUsed: number; resetsAt?: string }, now: number): Pace | undefined {
  const len = PACE_WINDOW_MS[l.kind]
  const resets = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!len || !Number.isFinite(resets) || resets <= now) return undefined
  const expected = Math.max(0, Math.min(100, (1 - (resets - now) / len) * 100))
  const ratio = l.percentUsed / Math.max(expected, PACE_MIN_EXPECTED)
  return { kind: l.kind, percentUsed: l.percentUsed, expected, ratio, steps: ratio >= PACE_TWO_DOWN ? 2 : ratio >= PACE_ONE_DOWN ? 1 : 0 }
}

/** The window furthest ahead of pace, or undefined when none has a pace. */
export function worstPace(
  limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[] | undefined,
  now: number,
): Pace | undefined {
  let worst: Pace | undefined
  for (const l of limits ?? []) {
    const p = paceOf(l, now)
    if (p && (!worst || p.ratio > worst.ratio)) worst = p
  }
  return worst
}

/** `7d window 10% used at 3% of the week: 3.3x pace, two tiers down`; `pooled week (both accounts) projected 116% by reset: two tiers down`. */
export function paceText(p: Pace): string {
  const down = p.steps === 2 ? ', two tiers down' : p.steps === 1 ? ', one tier down' : ''
  if (p.kind === 'pooled') return `pooled week (both accounts) projected ${Math.round(p.percentUsed)}% by reset${down.replace(',', ':')}`
  const name = p.kind === 'five_hour' ? '5h' : '7d'
  const span = p.kind === 'five_hour' ? 'window' : 'week'
  return `${name} window ${Math.round(p.percentUsed)}% used at ${Math.round(p.expected)}% of the ${span}: ${p.ratio.toFixed(1)}x pace${down}`
}

/** Where the router writes one JSON line per routed spawn, under `$HOME`, one file per day. */
export const DECISION_LOG_DIR = 'projects/data/logs/model-router'

/** One decision-log line: what was asked, what was chosen and why (no prompt text). */
export function decisionLine(d: {
  time: string; agentType: string; label: string; via: string; asked?: Tier; tier: Tier; model?: string
  why: string; judgeMin?: Tier; pace?: number; pressure?: number; budget?: number; risky?: boolean
}): string {
  return JSON.stringify(d) + '\n'
}

/** Where the pooled-usage job writes its reading, under `$HOME`. */
export const POOLED_PACE_FILE = 'projects/data/logs/usage/latest.json'
/** A pooled reading older than this is ignored. */
export const POOLED_MAX_AGE_MS = 12 * 3_600_000

/**
 * The pooled (both accounts) pace from the usage job's `latest.json` text, or undefined when it
 * doesn't parse, `level` isn't an integer 0-2, or `time` is missing, unparseable or over 12 hours old.
 */
export function parsePooledPace(text: string, now: number): Pace | undefined {
  try {
    const j = JSON.parse(text) as { level?: unknown; projected?: unknown; time?: unknown }
    const level = j.level
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 2) return undefined
    const at = typeof j.time === 'string' ? Date.parse(j.time) : NaN
    if (!Number.isFinite(at) || now - at > POOLED_MAX_AGE_MS) return undefined
    const projected = typeof j.projected === 'number' && Number.isFinite(j.projected) ? j.projected : 0
    return { kind: 'pooled', percentUsed: Math.round(projected * 100), expected: 100, ratio: projected, steps: level as 0 | 1 | 2 }
  } catch {
    return undefined
  }
}

/** The pace with more steps; the window pace on a tie. */
export function strongerPace(window: Pace | undefined, pooled: Pace | undefined): Pace | undefined {
  return pooled && (!window || pooled.steps > window.steps) ? pooled : window
}

/** The `pace` setting: true only for `on`. */
export function paceOn(setting: unknown): boolean {
  return setting === 'on' || setting === true
}

/** The `limitPressure` setting as a percentage, or undefined when off. */
export function pressureThreshold(setting: unknown): number | undefined {
  const n = Number(setting ?? 80)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : undefined
}

/** The share of the budget at which routing goes one tier cheaper; at 100% it goes cheapest. */
export const BUDGET_WARN = 80

/** The `budget` setting in dollars, or undefined when off. */
export function budgetUsd(setting: unknown): number | undefined {
  const n = Number(setting)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Bumped when replies are read differently, so verdicts an older reading stored are not reused. */
const CLASSIFIER_PARSE = 2

/**
 * What the classifier read, as one string: the cache's key before hashing. The rubric and the
 * parse version are part of it, so a new rubric or a new reading of replies doesn't reuse
 * verdicts the old one gave.
 */
export function classifyKey(input: { agentType: string; description: string; prompt: string }): string {
  return `parse ${CLASSIFIER_PARSE}\n${CLASSIFIER_SYSTEM}\n${input.agentType}\n${input.description}\n${input.prompt}`
}

/** The tier as the pane says it. */
export const TIER_WORD: Record<Tier, string> = { simple: 'easy', standard: 'normal', hard: 'hard', long: 'long' }

/**
 * One line on why an agent got its tier: what the classifier said, then each rule that moved
 * it. For the pane's expanded row.
 */
export function explainTier(o: {
  source: 'haiku' | 'builtin' | 'fallback'
  asked: Tier
  final: Tier
  role: string | undefined
  risky: boolean
  allowLong: boolean
  pressure?: number
  /** The window furthest ahead of pace, when pace lowered the agent. */
  pace?: Pace
  /** The session's spend as a share of its budget, when the budget moved the agent. */
  budget?: { pct: number; usd: number }
  cached?: boolean
}): string {
  const said =
    o.source === 'haiku'
      ? `classifier${o.cached ? ' (cached)' : ''}: ${TIER_WORD[o.asked]}${o.risky ? ' risky' : ''}`
      : o.source === 'builtin'
        ? `built-in classifier: ${TIER_WORD[o.asked]}`
        : `no classifier answer, ${o.role ?? 'agent'} default: ${TIER_WORD[o.asked]}`
  const rules: string[] = []
  const lim = o.role ? ROLE_LIMITS[o.role] : undefined
  if (lim?.max && ORDER.indexOf(o.asked) > ORDER.indexOf(lim.max)) rules.push(`${o.role} capped at ${TIER_WORD[lim.max]}`)
  if (lim?.min && ORDER.indexOf(o.asked) < ORDER.indexOf(lim.min)) rules.push(`${o.role} at least ${TIER_WORD[lim.min]}`)
  if (o.asked === 'long' && !o.allowLong) rules.push('long work not asked for')
  if (o.risky && o.final === 'hard' && ORDER.indexOf(o.asked) < ORDER.indexOf('hard')) rules.push('risk floor')
  if (o.pressure !== undefined) rules.push(`limits ${Math.round(o.pressure)}%: one tier down`)
  if (o.pace) rules.push(`lowered for pace: ${paceText(o.pace)}`)
  if (o.budget)
    rules.push(
      o.budget.pct >= 100
        ? `$${o.budget.usd} budget spent: cheapest allowed`
        : `${Math.round(o.budget.pct)}% of $${o.budget.usd} budget: one tier down`,
    )
  return o.final === o.asked && rules.length === 0
    ? said
    : `${said} → ${TIER_WORD[o.final]}${rules.length ? ` (${rules.join(', ')})` : ''}`
}

/** A duration as `0:42`, `3:05` or `1h04`. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** A rate-limit window's name for the pane: `5h limit`, `7d limit`. */
export function limitName(kind: string): string {
  return kind === 'five_hour' ? '5h limit' : kind === 'seven_day' ? '7d limit' : kind.replace(/_/g, ' ')
}

/** Time left as `42m`, `4h24` or `6d 1h`. */
export function untilText(ms: number): string {
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h${String(mins % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/**
 * A rate-limit window as `██░░░ 42%  resets in 4h24`; the reset is left out when unknown or
 * past. Full and light blocks, which every terminal font draws.
 */
export function windowGauge(l: { percentUsed: number; resetsAt?: string }, now: number): string {
  const pct = Math.max(0, Math.min(100, l.percentUsed))
  const filled = Math.round(pct / 20)
  const bar = '█'.repeat(filled) + '░'.repeat(5 - filled)
  const left = l.resetsAt ? Date.parse(l.resetsAt) - now : NaN
  const reset = Number.isFinite(left) && left > 0 ? `  resets in ${untilText(left)}` : ''
  return `${bar} ${Math.round(l.percentUsed)}%${reset}`
}

/**
 * When a cheap agent counts as struggling: tool calls failing in a row, or more requests or
 * time than its tier's work should take. Generous on purpose: a rescue switches models
 * mid-run, which rewrites the agent's whole context at the new model's price once.
 */
export const RESCUE = {
  errorsInARow: 3,
  steps: { simple: 25, standard: 60 } as Partial<Record<Tier, number>>,
  minutes: { simple: 10, standard: 30 } as Partial<Record<Tier, number>>,
}

/** Why an agent on `tier` should move up, or undefined while it is doing fine. */
export function rescueReason(tier: Tier, h: { errors: number; steps: number; ms: number }): string | undefined {
  if (h.errors >= RESCUE.errorsInARow) return `${h.errors} failed tool calls in a row`
  const steps = RESCUE.steps[tier]
  if (steps !== undefined && h.steps > steps) return `over ${steps} requests`
  const minutes = RESCUE.minutes[tier]
  if (minutes !== undefined && h.ms > minutes * 60_000) return `over ${minutes} minutes`
  return undefined
}

/** The tier a struggling agent moves up to: one step, never to `long`, never past its role's cap. */
export function rescueTier(tier: Tier, role: string | undefined): Tier | undefined {
  const i = ORDER.indexOf(tier) + 1
  const max = Math.min(ORDER.indexOf('hard'), role && ROLE_LIMITS[role]?.max ? ORDER.indexOf(ROLE_LIMITS[role]!.max!) : 3)
  return i <= max ? ORDER[i] : undefined
}

export function fallbackTier(role: string | undefined): Tier {
  return (role && ROLE_LIMITS[role]?.fallback) || 'standard'
}

/** Reads the classifier's reply: the tier word on its verdict line; undefined without one. */
export function parseTier(text: string): Tier | undefined {
  return TIER_RE.exec(verdictLine(text))?.[1]?.toLowerCase() as Tier | undefined
}

export const CLASSIFIER_SYSTEM = `You route coding subagent tasks to a model. Read the task and reply with exactly one word.

simple   - mechanical fan-out with a cheap check on the result: rename, find/search/grep, list files, summarize logs or test output, run an existing test, lint or build command and report, format, version bumps, small single-file edits with an obvious answer. Never simple: designing, planning, reviewing or judging work, finding a root cause, or writing something a person will read as the final answer.
standard - most coding work: implement, plan or review a feature or fix, write tests, refactor across several files, fix a bug whose failure is known, follow a detailed plan. Long or detailed instructions do not make a task harder; they make it easier.
hard     - only when the problem itself needs deep reasoning: a bug whose cause is unknown and intermittent or cross-cutting, concurrency or race conditions, a security audit, performance tuning, a design with real trade-offs between competing approaches, a data migration with subtle risk. Planning a change whose steps the task already spells out is standard.
long     - only when the task explicitly asks for long-running or unattended multi-hour work, such as a large build or migration left to run overnight. Running in the background is not long.

Pick the cheapest tier that will succeed. If unsure between simple and standard, pick standard. If unsure between standard and hard, pick standard.

Then add the word risky only if the agent itself will do costly or hard-to-reverse harm outside the working tree: deploying to production, a migration or destructive command against production or shared data, deleting data not in version control, rotating or exposing credentials, moving money, force-pushing over shared history. Judge only what the agent will run, not what the code it writes would do. Not risky: writing or editing code (including a migration or script that deletes data), running tests or a test database, committing locally, deleting files under version control.

Reply with the tier word alone, or the tier word and risky: for example "standard" or "hard risky". Do not explain.`

/** What the engine's built-in classifier reads when Haiku 4.5 gives no tier: no rubric, so keep it short. */
export function builtinClassifierText(input: { agentType: string; description: string; prompt: string }): string {
  const body = input.prompt.length > 2000 ? input.prompt.slice(0, 2000) + ' [...]' : input.prompt
  return `How hard is this coding task for an AI agent? Agent: ${input.agentType}. ${input.description}. ${body}`
}

export function classifierPrompt(input: {
  agentType: string
  description: string
  prompt: string
}): string {
  const body = input.prompt.length > 6000 ? input.prompt.slice(0, 6000) + '\n[...truncated]' : input.prompt
  return [
    `Agent type: ${input.agentType}`,
    `Short description: ${input.description}`,
    'Task:',
    '<task>',
    body,
    '</task>',
  ].join('\n')
}

export function usd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

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
 * within the 8-token cap, at a seventh of Haiku 4.5's cost, and placed a small feature as
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
  hard: undefined,
  long: undefined,
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

/**
 * Cost of one request's tokens on a family. Haiku 5.5 switches price above a 100K-token prompt,
 * so call it per request; on summed tokens it prices everything at the lower rate.
 * Cache writes cost 1.25x input for 5 minutes, 2x for an hour.
 */
export function costOf(t: Tokens, family: Family, ttl: CacheTtl = '5m'): number {
  const prompt = t.input + t.cacheRead + t.cacheWrite
  const p = family === 'haiku5' && prompt > HAIKU5_LONG_FROM ? HAIKU5_LONG : PRICES[family]
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
export const PRESSURE_FLOOR: Record<string, Tier> = { builder: 'standard', fixer: 'standard' }

export function routeTier(
  tier: Tier,
  role: string | undefined,
  allowLong: boolean,
  o: { risky?: boolean; underPressure?: boolean } = {},
): Tier {
  const i = ORDER.indexOf(tier)
  const floor = role && PRESSURE_FLOOR[role] ? Math.min(i, ORDER.indexOf(PRESSURE_FLOOR[role]!)) : 0
  let t = clampTier(o.underPressure ? ORDER[Math.max(floor, i - 1)]! : tier, role, allowLong && !o.underPressure)
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

export function looksRisky(text: string): boolean {
  return RISKY_ACT.test(text)
}

/** Reads the classifier's risk flag: the word `risky` after the tier. */
export function parseRisky(text: string): boolean {
  return /\brisky\b/i.test(text)
}

/** The fullest rate-limit window, in percent; 0 off a subscription or before the first reading. */
export function fullestWindow(limits: readonly { percentUsed: number }[] | undefined): number {
  return (limits ?? []).reduce((m, l) => Math.max(m, l.percentUsed), 0)
}

/** The `limitPressure` setting as a percentage, or undefined when off. */
export function pressureThreshold(setting: unknown): number | undefined {
  const n = Number(setting ?? 80)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : undefined
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
}): string {
  const said =
    o.source === 'haiku'
      ? `classifier: ${TIER_WORD[o.asked]}${o.risky ? ' risky' : ''}`
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

export function fallbackTier(role: string | undefined): Tier {
  return (role && ROLE_LIMITS[role]?.fallback) || 'standard'
}

/** Reads the classifier's reply: the first tier word it names. */
export function parseTier(text: string): Tier | undefined {
  const m = /\b(simple|standard|hard|long)\b/i.exec(text)
  return m ? (m[1]!.toLowerCase() as Tier) : undefined
}

export const CLASSIFIER_SYSTEM = `You route coding subagent tasks to a model. Read the task and reply with exactly one word.

simple   - mechanical, little judgment: rename, find/search/grep, list files, run an existing test or build command and report, format, small single-file edits with an obvious answer.
standard - normal feature work: implement a function or component, write tests, a refactor within a few files, a bug with a clear repro.
hard     - needs deep reasoning: architecture or design decisions, an intermittent or cross-cutting bug, concurrency, security, performance work, a migration with subtle risk.
long     - only when the task explicitly asks for long-running or unattended multi-hour work, such as a large build or migration left to run overnight. Running in the background is not long.

Pick the cheapest tier that will succeed. If unsure between two, pick the higher.

Then add the word risky if carrying out the task itself could do costly or hard-to-reverse harm: deploying to production, running a migration or a destructive command against production or shared data, deleting data, rotating or exposing credentials, moving money, force-pushing over shared history. Judge the act, not the subject: writing, refactoring or testing code that deals with payments, databases or credentials is not risky.

Reply with the tier word alone, or the tier word and risky: for example "standard" or "hard risky".`

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

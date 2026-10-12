import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, RouterLedger, Tier, Tokens } from '../types'
import { ROLES, ROLE_MODEL } from './lib/agents'
import {
  CLASSIFIER_MODEL,
  CLASSIFIER_SYSTEM,
  EFFORT_CAP,
  FORCED_TIER,
  MODEL_FOR_TIER,
  ORDER,
  ZERO,
  addTokens,
  asksForLongRun,
  builtinClassifierText,
  capEffort,
  classifierPrompt,
  costOf,
  fallbackTier,
  familyOf,
  fullestWindow,
  looksRisky,
  parseMode,
  parseRisky,
  parseTier,
  pressureThreshold,
  roleOf,
  routeTier,
  tierOfModel,
  tokensFromUsage,
  usd,
  type Family,
  type Effort,
  type Mode,
} from './lib/pricing'

const PANE = 'model-router'
const EMPTY: RouterLedger = { rows: {}, classifierCost: 0, routed: 0 }
const ledger = atom({ plugin: 'model-router', key: 'ledger' } as const, EMPTY)

const TIER_WORD: Record<Tier, string> = { simple: 'easy', standard: 'normal', hard: 'hard', long: 'long' }

/** The classifier's budget. A spawn waits on it, so a slow answer costs more than a wrong tier. */
const CLASSIFY_MS = 3000
/** How long a subagent's first request waits for its spawn to be recorded, so it gets its effort. */
const SPAWN_WAIT_MS = 2000
const MODE_KEY = 'mode'
/** The model each unrouted agent type was last seen running on, for a fair baseline. */
const TYPE_MODELS_KEY = 'agentModels'

/** A router role's registered model as a full id, the model it runs on unrouted. */
const ROLE_BASELINE = MODEL_FOR_TIER[tierOfModel(ROLE_MODEL)]

/** True for the router's own roles, as registered from ROLES. */
function isRole(role: string | undefined): boolean {
  return ROLES.some(r => r.name === role)
}

type Baseline = 'unrouted' | Exclude<Family, 'haiku4' | 'haiku5'>

function blankRow(id: string, label: string, agentType: string, now: number): AgentRow {
  return { id, label, agentType, tokens: ZERO, cost: 0, startedAt: now }
}

function shortModel(model: string | undefined): string {
  if (!model) return '?'
  return { haiku4: 'Haiku4', haiku5: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' }[familyOf(model)]
}

/**
 * The same tokens on the baseline. Priced on the row's summed tokens, so a fixed baseline
 * or a later change of the setting reprices the whole bill.
 */
function baselineCost(r: AgentRow, baseline: Baseline): number {
  const family = baseline === 'unrouted' ? familyOf(r.baselineModel ?? r.model) : baseline
  return costOf(r.tokens, family)
}

function totals(l: RouterLedger, baseline: Baseline) {
  let cost = l.classifierCost
  let base = 0
  for (const r of Object.values(l.rows)) {
    cost += r.cost
    base += baselineCost(r, baseline)
  }
  return { cost, base, saved: base > 0 ? 1 - cost / base : 0 }
}

/** A spawn's row details, kept in memory so a row that `/clear` wiped can be written again. */
type SpawnRow = Partial<AgentRow> & { startedAt: number }

/**
 * The row a step or a finish writes to: the ledger's, else one rebuilt from what the spawn
 * recorded (its tokens and cost start over), else a blank one. `routed` counts a rebuilt
 * routed row again, since the wipe took its count with it.
 */
function rowFor(
  l: RouterLedger,
  id: string,
  now: number,
  spawnRows: ReadonlyMap<string, SpawnRow>,
): { row: AgentRow; routed: number } {
  const row = l.rows[id]
  if (row) return { row, routed: l.routed }
  const blank =
    id === 'main' ? blankRow(id, 'main conversation', 'main', now) : blankRow(id, 'subagent', '?', now)
  const saved = spawnRows.get(id)
  if (!saved) return { row: blank, routed: l.routed }
  return {
    row: { ...blank, ...saved, tokens: ZERO, cost: 0 },
    routed: l.routed + (saved.via !== undefined && saved.via !== 'unrouted' ? 1 : 0),
  }
}

/** Writes a spawned agent's row; its steps may have landed first, so it merges into them. */
async function record(
  $: EngineInterface,
  id: string,
  now: number,
  fields: Partial<AgentRow>,
  routed: boolean,
  spawnRows: Map<string, SpawnRow>,
) {
  // Dropped oldest first, never all at once: a running agent's details must outlive a burst of spawns.
  if (spawnRows.size > 500) spawnRows.delete(spawnRows.keys().next().value!)
  spawnRows.set(id, { ...fields, startedAt: now })
  await update($, ledger, l => {
    const row = l.rows[id] ?? blankRow(id, 'subagent', '?', now)
    return { ...l, routed: l.routed + (routed ? 1 : 0), rows: { ...l.rows, [id]: { ...row, ...fields } } }
  })
}

/** How long a finished agent's line stays in the band above the prompt. */
const BAND_FADE_MS = 30_000

/**
 * Marks an agent finished, once: its row gets `finishedAt`, restored first if a `/clear`
 * wiped it, and the band is drawn again when the line's time is up.
 */
async function finishAgent($: EngineInterface, id: string, spawnRows: ReadonlyMap<string, SpawnRow>) {
  const now = await $.clock.now()
  let finished = false
  await update($, ledger, l => {
    finished = false
    if (!l.rows[id] && !spawnRows.has(id)) return l
    const { row, routed } = rowFor(l, id, now, spawnRows)
    if (row.finishedAt !== undefined) return l
    finished = true
    return { ...l, routed, rows: { ...l.rows, [id]: { ...row, finishedAt: now } } }
  })
  if (finished) $.clock.after(BAND_FADE_MS, () => $.ui.invalidate('ui.render'))
}

/** The pane's fixed column widths; Agent takes what is left of the pane. */
const TIER_WIDTH = 8
const MODEL_WIDTH = 8
const COST_WIDTH = 8
const BASE_WIDTH = 10
const FIXED_WIDTH = TIER_WIDTH + MODEL_WIDTH + COST_WIDTH + BASE_WIDTH
/** The narrowest Agent column: a few characters and the ellipsis. */
const AGENT_MIN = 4

/** Tier word for the pane: `!` when the risk floor raised it, `↓` when rate limits lowered it. */
function tierLabel(r: AgentRow): string {
  if (!r.tier || r.via === 'unrouted') return '-'
  return TIER_WORD[r.tier] + (r.risky ? '!' : r.pressure !== undefined ? '↓' : '')
}

/** One running (or just finished) routed subagent, as the band above the prompt shows it. */
function bandLine(r: AgentRow): string {
  return `⇄ ${roleOf(r.agentType) ?? r.agentType}: ${r.label} → ${shortModel(r.model)} · ${usd(r.cost)}`
}

/** The pane's savings: `saved N%`, or `N% more` when routing cost more than the baseline. */
function savedText(t: { base: number; saved: number }): string {
  if (t.base <= 0) return ''
  const pct = Math.round(t.saved * 100)
  return pct < 0 ? `   ${-pct}% more` : `   saved ${pct}%`
}

/** The status line's savings: `N% saved`, or `N% more` when routing cost more than the baseline. */
function statusSaved(saved: number): string {
  const pct = Math.round(saved * 100)
  return pct < 0 ? `${-pct}% more` : `${pct}% saved`
}

/** A label cut to fit `width` cells with a space to spare, ending in `…` when cut. */
function fit(text: string, width: number): string {
  return text.length > width - 1 ? text.slice(0, Math.max(0, width - 2)) + '…' : text
}

/** The fullest rate-limit window in percent; 0 when the engine has none or the call fails. */
async function windowPercent($: EngineInterface): Promise<number> {
  try {
    return fullestWindow((await $.session.usage()).rateLimits)
  } catch {
    return 0
  }
}

/** What a mode does, as `/router` and `/router status` say it. */
function modeText(mode: Mode): string {
  if (mode === 'on') return 'on: Haiku picks the model for each subagent'
  if (mode === 'off') return 'off: subagents run on the model they would have without the router'
  return `sending every routed subagent to ${shortModel(MODEL_FOR_TIER[FORCED_TIER[mode]])}`
}

function modeLabel(mode: Mode): string | undefined {
  if (mode === 'on') return undefined
  if (mode === 'off') return 'router off'
  return `router: all ${shortModel(MODEL_FOR_TIER[FORCED_TIER[mode]])}`
}

async function refreshStatus(
  $: EngineInterface,
  baseline: Baseline,
  baselineName: string,
  mode: Mode,
  pressureAt: number | undefined,
) {
  const t = totals(await read($, ledger), baseline)
  const parts = [modeLabel(mode)]
  if (mode === 'on' && pressureAt !== undefined) {
    const pct = await windowPercent($)
    if (pct >= pressureAt) parts.push(`limits ${Math.round(pct)}%: one tier down`)
  }
  if (t.base > 0) parts.push(`${usd(t.cost)} vs ${usd(t.base)} ${baselineName} (${statusSaved(t.saved)})`)
  const text = parts.filter(Boolean).join(' · ')
  $.ui.status(text || undefined)
}

/** Resolves undefined after `ms`, so a call raced against it can't hold a spawn up. */
function timeout($: EngineInterface, ms: number): Promise<undefined> {
  return $.clock.sleep(ms).then(() => undefined)
}

/** The `/router` mode saved by an earlier session, if any. */
async function storedMode($: EngineInterface): Promise<Mode | undefined> {
  try {
    return parseMode(await $.store.get(MODE_KEY))
  } catch {
    return undefined
  }
}

/** The models agent types ran on in earlier sessions; empty when nothing is stored or the read fails. */
async function storedTypeModels($: EngineInterface): Promise<Record<string, string>> {
  try {
    const v = await $.store.get(TYPE_MODELS_KEY)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter((p): p is [string, string] => typeof p[1] === 'string'))
  } catch {
    return {}
  }
}

type TypeModels = { models: Record<string, string>; loaded: boolean }

/** Reads the stored type models once; a type seen before the read keeps what was seen. */
async function loadTypeModels($: EngineInterface, t: TypeModels) {
  if (t.loaded) return
  t.loaded = true
  t.models = { ...(await storedTypeModels($)), ...t.models }
}

/** Remembers the model an unrouted agent type ran on, writing the store only on a change. */
async function rememberTypeModel($: EngineInterface, t: TypeModels, type: string, model: string) {
  if (t.models[type] === model) return
  t.models = { ...t.models, [type]: model }
  try {
    await $.store.set(TYPE_MODELS_KEY, t.models)
  } catch (err) {
    $.ui.log(`could not save the model of ${type}: ${String(err)}`)
  }
}

/**
 * The effort cap of a routed subagent. Its first step can beat its spawn's answer, so it
 * waits briefly for spawns in flight. The caps are kept in memory because a hook reads
 * `$.state` as of the moment it started: a row written during the wait is not seen. The
 * ledger is the fallback after a hot reload has emptied memory.
 */
async function effortCapOf(
  $: EngineInterface,
  agentId: string,
  caps: ReadonlyMap<string, Effort | undefined>,
  starting: ReadonlySet<Promise<unknown>>,
) {
  if (!caps.has(agentId) && starting.size > 0) {
    await Promise.race([Promise.allSettled([...starting]), timeout($, SPAWN_WAIT_MS)])
  }
  return caps.has(agentId) ? caps.get(agentId) : (await read($, ledger)).rows[agentId]?.effort
}

export const register: Register = (on, options) => {
  const baseline = (['unrouted', 'fable', 'opus', 'sonnet'].includes(String(options.baseline))
    ? options.baseline
    : 'unrouted') as Baseline
  const routeAll = options.routeAll !== false
  const respectExplicit = options.respectExplicitModel !== false
  const baselineName = baseline === 'unrouted' ? 'unrouted' : `on ${shortModel(baseline)}`
  const effortByTier = options.effortByTier !== false
  const riskFloor = options.riskFloor !== false
  const pressureAt = options.limitPressure === 'off' ? undefined : pressureThreshold(options.limitPressure)

  // Module state starts over on a hot reload; the mode is read back from the store.
  let mode: Mode = 'on'
  let modeLoaded = false
  /**
   * The model each agent type ran on when the router left it alone, by type. A built-in
   * such as Explore runs on its own model, not its parent's, so this is its baseline.
   */
  const typeModels: TypeModels = { models: {}, loaded: false }
  /** Agent calls that set their own effort, by tool_use_id, until their spawn reads it. */
  const callEffort = new Set<string>()
  /** Spawns between the call to `next` and its answer, which a first step may overtake. */
  const starting = new Set<Promise<unknown>>()
  /** Each routed subagent's effort cap, by agent id, as soon as it has started. */
  const effortCaps = new Map<string, Effort | undefined>()
  /** Each spawn's row details, by agent id, for rows a `/clear` wiped while the agent ran on. */
  const spawnRows = new Map<string, SpawnRow>()

  on('session.start', async ($, e, next) => {
    if (!modeLoaded) {
      modeLoaded = true
      mode = (await storedMode($)) ?? mode
    }
    if (mode !== 'on') $.ui.status(modeLabel(mode))
    for (const role of ROLES) {
      try {
        await $.agent.register({ ...role, model: ROLE_MODEL })
      } catch (err) {
        $.ui.log(`could not add agent ${role.name}: ${String(err)}`)
      }
    }
    try {
      await $.command.register({
        name: 'router',
        description: 'Open the model router bill pane; on, off, haiku, sonnet or opus sets the mode; reset clears the bill',
        argumentHint: '[on|off|haiku|sonnet|opus|status|reset]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log(`could not add /router: ${String(err)}`)
    }
    // Opened unasked, so it only seats in a wide terminal; /router opens it anywhere.
    void $.ui.open({ id: PANE, title: 'Model router' })
    return next(e)
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (!modeLoaded) {
      modeLoaded = true
      mode = (await storedMode($)) ?? mode
    }
    if (arg === 'reset') {
      await update($, ledger, () => EMPTY)
      $.ui.status(modeLabel(mode))
      return { text: 'Model router bill cleared.' }
    }
    if (arg === 'status') return { text: `Model router ${modeText(mode)}.` }
    const picked = parseMode(arg)
    if (picked) {
      mode = picked
      modeLoaded = true
      try {
        await $.store.set(MODE_KEY, mode)
      } catch (err) {
        $.ui.log(`could not save the router mode: ${String(err)}`)
      }
      await refreshStatus($, baseline, baselineName, mode, pressureAt)
      const back = mode === 'on' ? '' : '; /router on to go back'
      return { text: `Model router ${modeText(mode)}. Kept across sessions${back}.` }
    }
    if (arg) return { text: `Unknown option "${arg}". Use on, off, haiku, sonnet, opus, status or reset.` }
    await $.ui.open({ id: PANE, title: 'Model router', focus: true, closeOnEscape: true })
    return {}
  })

  // An Agent call that sets its own effort was asked for that effort: remember it so
  // the router leaves that agent's effort alone.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.tool === 'Agent' && e.effort && e.tool_use_id) {
      // Read and removed by the spawn; a call that never spawns leaves one id behind.
      if (callEffort.size > 200) callEffort.clear()
      callEffort.add(e.tool_use_id)
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a note about effort is a side job: never block the call

  // 1. Haiku reads the task and sorts it. 2. The router sets the model.
  on('agent.spawn', async ($, e, next) => {
    if (!modeLoaded) {
      modeLoaded = true
      mode = (await storedMode($)) ?? mode
    }
    await loadTypeModels($, typeModels)
    const callSetEffort = callEffort.delete(e.tool_use_id)
    const role = roleOf(e.subagentType)
    const now = await $.clock.now()

    // Not routed: forks always inherit, a workflow agent's model cannot be rewritten,
    // a teammate is long-lived and always background (so it would qualify for Fable on
    // its first message alone), and with routing narrowed only the router's own agents
    // are touched. `/router off` leaves everything alone.
    if (mode === 'off' || e.fork || e.workflow || e.isTeammate || (!routeAll && !role)) {
      const result = await next(e)
      if (result.deny === undefined && result.agentId) {
        await record($, result.agentId, now, {
          label: e.description || e.name || e.subagentType,
          agentType: e.subagentType,
          via: 'unrouted',
          model: result.model,
          baselineModel: result.model,
        }, false, spawnRows)
        // What this type runs on by itself: a fork or teammate takes its parent's, a
        // workflow agent or a named model is the call's choice, not the type's. The
        // router's own agents are compared with their registered model instead.
        if (!role && !e.fork && !e.workflow && !e.isTeammate && !e.model && result.model) {
          await rememberTypeModel($, typeModels, e.subagentType, result.model)
        }
      }
      return result
    }

    let tier: Tier
    let via: AgentRow['via']
    let model: string | undefined
    let risky = false
    let pressure: number | undefined

    if (respectExplicit && e.model) {
      via = 'explicit'
      model = e.model
      tier = tierOfModel(e.model)
    } else if (mode !== 'on') {
      via = 'forced'
      tier = FORCED_TIER[mode]
      model = MODEL_FOR_TIER[tier]
    } else {
      let picked: Tier | undefined
      try {
        const r = await $.model.complete(
          {
            model: CLASSIFIER_MODEL,
            system: CLASSIFIER_SYSTEM,
            prompt: classifierPrompt({
              agentType: e.subagentType,
              description: e.description,
              prompt: e.prompt,
            }),
            maxTokens: 8,
            timeoutMs: CLASSIFY_MS,
          },
          { signal: next.signal },
        )
        const c = costOf(tokensFromUsage(r.usage), familyOf(CLASSIFIER_MODEL))
        await update($, ledger, l => ({ ...l, classifierCost: l.classifierCost + c }))
        if (r.isAnswered) {
          picked = parseTier(r.text)
          risky = parseRisky(r.text)
        }
      } catch {
        // try the built-in classifier
      }
      via = picked ? 'haiku' : undefined
      if (!picked) {
        // The engine's own small model, with no rubric: worse than Haiku 4.5 with one, better
        // than a fixed default, and it keeps working if the pinned classifier model goes away.
        try {
          const label = await Promise.race([
            $.model.classify(builtinClassifierText({
              agentType: e.subagentType,
              description: e.description,
              prompt: e.prompt,
            }), ORDER),
            timeout($, CLASSIFY_MS),
          ])
          picked = parseTier(label ?? '')
          if (picked) via = 'builtin'
        } catch {
          // fall through to the role's default
        }
      }
      via ??= 'fallback'
      // Without Haiku's judgment, only a plainly destructive act counts as risky.
      if (via !== 'haiku') risky ||= looksRisky(`${e.description}\n${e.prompt}`)
      risky &&= riskFloor
      const asked = picked ?? fallbackTier(role)
      // Agents run in the background by default, so only the task's own words open up `long`.
      const allowLong = asksForLongRun(`${e.description}\n${e.prompt}`)
      tier = routeTier(asked, role, allowLong, { risky })
      if (pressureAt !== undefined) {
        const pct = await windowPercent($)
        const lower = pct >= pressureAt ? routeTier(asked, role, allowLong, { risky, underPressure: true }) : tier
        // Marked only when the window actually moved the agent down.
        if (lower !== tier) {
          tier = lower
          pressure = pct
        }
      }
      model = MODEL_FOR_TIER[tier]
    }

    // Effort is set per request in turn.step; here the router only decides the cap.
    const effort =
      effortByTier && via !== 'explicit' && via !== 'forced' && !callSetEffort
        ? EFFORT_CAP[tier]
        : undefined

    // Held in `starting` until the cap is known: the agent's first request can arrive
    // before `next` answers and must wait for its effort cap.
    const spawned = (async () => {
      const result = await next({ ...e, model })
      if (result.deny !== undefined || !result.agentId) return result
      if (effortCaps.size > 500) effortCaps.clear()
      effortCaps.set(result.agentId, effort)
      await record($, result.agentId, now, {
        label: e.description,
        agentType: e.subagentType,
        tier,
        via,
        model: result.model,
        effort,
        risky: risky || undefined,
        pressure,
        // A model Claude named would have run anyway. A router role runs on its registered
        // model; another type on its own model when it was seen running unrouted (a built-in
        // such as Explore), else on the parent's it inherits.
        baselineModel:
          via === 'explicit'
            ? result.model
            : isRole(role)
              ? ROLE_BASELINE
              : (typeModels.models[e.subagentType] ?? e.parentModel),
      }, true, spawnRows)
      return result
    })()
    starting.add(spawned)
    try {
      return await spawned
    } finally {
      starting.delete(spawned)
    }
  }).catch(($, e, next) => next(e)) // routing is an optimisation: on failure, spawn as asked

  // 3. Effort, lowered for easy tiers. 4. The bill: every model request, priced on the model that answered it.
  on('turn.step', async function* ($, e, next) {
    let request = e
    if (effortByTier && e.agentId && e.effort !== undefined) {
      try {
        const effort = capEffort(e.effort, await effortCapOf($, e.agentId, effortCaps, starting))
        if (effort !== e.effort) request = { ...e, effort }
      } catch {
        // leave the request as it is
      }
    }
    const result = yield* next(request)
    if (!result.usage) return result
    const usage = result.usage
    const t: Tokens = tokensFromUsage(usage)
    const id = e.agentId ?? 'main'
    const actual = costOf(t, familyOf(usage.model))
    const now = await $.clock.now()
    await update($, ledger, l => {
      const { row, routed } = rowFor(l, id, now, spawnRows)
      return {
        ...l,
        routed,
        rows: {
          ...l.rows,
          [id]: {
            ...row,
            model: row.model ?? usage.model,
            via: row.via ?? (id === 'main' ? 'unrouted' : row.via),
            baselineModel: row.baselineModel ?? (id === 'main' ? usage.model : undefined),
            tokens: addTokens(row.tokens, t),
            cost: row.cost + actual,
            // A finished agent woken again (SendMessage) is running once more.
            finishedAt: undefined,
          },
        },
      }
    })
    return result
  })

  // A subagent's run ends with its own turn.complete; SubagentStop backs it up. Either
  // marks the row finished (once) and brings the status line up to date at once.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) await finishAgent($, e.agentId, spawnRows)
    await refreshStatus($, baseline, baselineName, mode, pressureAt)
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await finishAgent($, e.agent_id, spawnRows)
    await refreshStatus($, baseline, baselineName, mode, pressureAt)
    return next(e)
  }).catch(($, e, next) => next(e)) // the bill is a side job: never hold up a stop

  // /clear starts a new session with an empty bill, so the totals go. Kept to one call:
  // session.end shares a short bound. spawnRows stays, for agents still running.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') $.ui.status(modeLabel(mode))
    return next(e)
  })

  // The band above the prompt: one line per routed subagent while it runs, fading
  // BAND_FADE_MS after it finished.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const l = await read($, ledger)
    const now = await $.clock.now()
    const rows = Object.values(l.rows)
      .filter(r => r.id !== 'main' && r.via !== undefined && r.via !== 'unrouted')
      .filter(r => r.finishedAt === undefined || now - r.finishedAt < BAND_FADE_MS)
      .sort((a, b) => a.startedAt - b.startedAt)
    if (rows.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {rows.slice(0, Math.max(1, e.props.maxRows)).map(r => (
          <Text wrap="truncate" dimColor={r.finishedAt !== undefined}>
            {bandLine(r)}
          </Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const l = await read($, ledger)
    const t = totals(l, baseline)
    const width = Math.max(FIXED_WIDTH + AGENT_MIN, (e.props.bodyColumns ?? 60) - 2)
    const rows = Object.values(l.rows).sort((a, b) => b.startedAt - a.startedAt)
    const agents = rows.filter(r => r.id !== 'main').length
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 14)
    const shown = rows.slice(0, room)
    const agentWidth = width - FIXED_WIDTH
    const baseHead = baseline === 'unrouted' ? 'Unrouted' : `On ${shortModel(baseline)}`
    const hasRisky = shown.some(r => tierLabel(r).endsWith('!'))
    const hasPressure = shown.some(r => tierLabel(r).endsWith('↓'))

    // One fixed-width Box per cell, each a single Text; the money columns right-aligned.
    const cells = (agent: string, tier: string, model: string, cost: string, base: string, dim: boolean) => (
      <Box flexDirection="row">
        <Box width={agentWidth}>
          <Text wrap="truncate" dimColor={dim}>{fit(agent, agentWidth)}</Text>
        </Box>
        <Box width={TIER_WIDTH} flexShrink={0}>
          <Text wrap="truncate" dimColor={dim}>{tier}</Text>
        </Box>
        <Box width={MODEL_WIDTH} flexShrink={0}>
          <Text wrap="truncate" dimColor={dim}>{model}</Text>
        </Box>
        <Box width={COST_WIDTH} flexShrink={0} justifyContent="flex-end">
          <Text wrap="truncate" dimColor={dim}>{cost}</Text>
        </Box>
        <Box width={BASE_WIDTH} flexShrink={0} justifyContent="flex-end">
          <Text wrap="truncate" dimColor={dim}>{base}</Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" width={width}>
        <Text bold>{`Model router · ${mode}`}</Text>
        {mode !== 'on' && <Text color="yellow">{`${modeLabel(mode)} (/router on to go back)`}</Text>}
        <Text>{`Spent ${usd(t.cost)}`}</Text>
        <Text color={t.saved > 0 ? 'green' : undefined}>
          {`${baseHead} ${usd(t.base)}` + savedText(t)}
        </Text>
        <Text> </Text>
        {agents === 0 ? (
          <Text dimColor wrap="wrap">No subagents yet. Ask Claude to use an agent and it shows up here.</Text>
        ) : (
          <Box flexDirection="column">
            {cells('Agent', 'Tier', 'Model', 'Cost', baseHead, true)}
            <Text dimColor>{'─'.repeat(width)}</Text>
            {shown.map(r =>
              cells(
                r.label,
                tierLabel(r),
                shortModel(r.model),
                usd(r.cost),
                usd(baselineCost(r, baseline)),
                r.via === 'unrouted',
              ),
            )}
            {rows.length > room && <Text dimColor>{`…${rows.length - room} more`}</Text>}
            <Text> </Text>
            <Text dimColor>
              {`${agents} agent${agents === 1 ? '' : 's'} · ${l.routed} routed · classifier ${usd(l.classifierCost)}`}
            </Text>
            {hasRisky && <Text dimColor>! risky: sent to Opus at least</Text>}
            {hasPressure && <Text dimColor>↓ one tier lower for rate limits</Text>}
            <Text dimColor wrap="wrap">
              Dim rows are not routed. API list prices; plans billed by subscription see rate-limit use, not dollars.
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}

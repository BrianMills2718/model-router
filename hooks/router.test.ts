import { describe, expect, mock, test } from 'claude-code/testing'

import {
  asksForLongRun,
  capEffort,
  clampTier,
  costOf,
  familyOf,
  looksRisky,
  parseMode,
  parseRisky,
  parseTier,
  routeTier,
  tierOfModel,
} from './lib/pricing'

/** Billionths of a dollar, so float sums compare exactly. */
const nano = (usd: number) => Math.round(usd * 1e9)

const USAGE = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

function spawnInput(over: Record<string, unknown> = {}) {
  return {
    tool_use_id: 'tu1',
    prompt: 'Rename the variable fooBar to fooBaz in src/a.ts',
    description: 'rename fooBar',
    subagentType: 'model-router:builder',
    provider: { plugin: 'model-router', tier: 'user' as const },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    ...over,
  }
}

describe('pure routing rules', () => {
  test('pricing families', async () => {
    expect(familyOf('claude-haiku-4-5-20251001')).toBe('haiku4')
    expect(familyOf('claude-haiku-5-5')).toBe('haiku5')
    expect(familyOf('haiku')).toBe('haiku5')
    expect(familyOf('claude-mythos-5-1')).toBe('fable')
    // Fable is 10x Haiku 4.5 per token, input and output
    const t = { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0 }
    expect(costOf(t, 'fable') / costOf(t, 'haiku4')).toBe(10)
  })

  test('Haiku 5.5 costs five times as much above a 100K-token prompt', async () => {
    const small = { input: 50_000, output: 1000, cacheRead: 50_000, cacheWrite: 0 }
    const big = { input: 50_000, output: 1000, cacheRead: 50_001, cacheWrite: 0 }
    // 50K x $0.10 + 50K x $0.01 + 1K x $0.50 = $0.006
    expect(nano(costOf(small, 'haiku5'))).toBe(6_000_000)
    // 50K x $0.50 + 50,001 x $0.05 + 1K x $2.50 = $0.03000005
    expect(nano(costOf(big, 'haiku5'))).toBe(30_000_050)
  })

  test('Sonnet 5.5 cache reads are $0.10 per million', async () => {
    expect(nano(costOf({ input: 0, output: 0, cacheRead: 1e6, cacheWrite: 0 }, 'sonnet'))).toBe(100_000_000)
  })

  test('tiers and caps', async () => {
    expect(parseTier('Hard.')).toBe('hard')
    expect(parseTier('dunno')).toBe(undefined)
    expect(clampTier('long', 'runner')).toBe('standard')
    expect(clampTier('simple', 'architect')).toBe('standard')
    expect(clampTier('simple', undefined)).toBe('simple')
    // third argument: whether the task asked for a long run
    expect(clampTier('long', 'builder', false)).toBe('hard')
    expect(clampTier('long', 'builder', true)).toBe('long')
    expect(tierOfModel('opus')).toBe('hard')
    expect(tierOfModel('claude-haiku-4-5')).toBe('simple')
  })

  test('long only when the task asks for a long or unattended run', async () => {
    expect(asksForLongRun('migrate all services unattended overnight')).toBe(true)
    expect(asksForLongRun('Start a long-running build of every package')).toBe(true)
    expect(asksForLongRun('keep going until every test passes')).toBe(true)
    expect(asksForLongRun('run this in the background')).toBe(false)
    expect(asksForLongRun('rename x')).toBe(false)
    expect(asksForLongRun('in the long run this saves time')).toBe(false)
  })

  test('effort is only ever lowered', async () => {
    expect(capEffort('high', 'low')).toBe('low')
    expect(capEffort('low', 'medium')).toBe('low')
    expect(capEffort('xhigh', undefined)).toBe('xhigh')
    expect(capEffort(4096, 'low')).toBe(4096)
    expect(capEffort(undefined, 'low')).toBe(undefined)
    expect(parseMode(' Sonnet ')).toBe('sonnet')
    expect(parseMode('fable')).toBe(undefined)
  })
})

/** Records the effort each request reaches the engine with; register it before the test's first `$` call. */
function captureEffort(on: any) {
  const seen: { effort?: unknown } = { effort: 'unset' }
  on('turn.step', async function* (_$: unknown, e: any) {
    seen.effort = e.effort
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as never }
  })
  return seen
}

/** Runs one request of agent `agentId` through the plugin. */
async function step($: any, agentId: string, effort: string | undefined) {
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId, effort })
  for await (const _ of s) {
    // drain
  }
  await s.result
}

describe('agent.spawn', () => {
  test('Haiku says simple, the builder runs on Haiku 5.5', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'a1' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-haiku-5-5')
  })

  test('the runner is capped at Sonnet even when Haiku says long', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'long', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'a2' }
    })
    await $.agent.spawn(spawnInput({ subagentType: 'model-router:runner' }))
    expect(spawnedOn).toBe('claude-sonnet-5-5')
  })

  test('long goes to Opus for a task that does not ask for a long run', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'long', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'l1' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-opus-5-5')
  })

  test('running in the background is not a long run', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'long', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'l2' }
    })
    await $.agent.spawn(spawnInput({ background: true }))
    expect(spawnedOn).toBe('claude-opus-5-5')
  })

  test('a task that asks for an unattended run goes to Fable', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'long', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'l3' }
    })
    await $.agent.spawn(spawnInput({ prompt: 'Run the whole migration unattended overnight', description: 'migration' }))
    expect(spawnedOn).toBe('claude-fable-5-1')
  })

  test('a failed classifier falls back to the role default', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: {
      isAnswered: false as const,
      reason: 'api-error' as const,
      status: 529,
      error: 'overloaded' as const,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'a3' }
    })
    await $.agent.spawn(spawnInput({ subagentType: 'model-router:architect' }))
    expect(spawnedOn).toBe('claude-opus-5-5')
  })

  test('a model the caller named is kept', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    let classified = false
    on('model.complete', async () => {
      classified = true
      return { value: { isAnswered: true as const, text: 'simple', usage: USAGE } }
    })
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'a4' }
    })
    await $.agent.spawn(spawnInput({ model: 'opus' }))
    expect(spawnedOn).toBe('opus')
    expect(classified).toBe(false)
  })

  test('forks are left alone', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined = 'unset'
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: 'claude-opus-5-5', agentId: 'a5' }
    })
    await $.agent.spawn(spawnInput({ fork: true, subagentType: 'fork' }))
    expect(spawnedOn).toBe(undefined)
  })

  test('teammates are left alone and not classified', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined = 'unset'
    let classified = false
    on('model.complete', async () => {
      classified = true
      return { value: { isAnswered: true as const, text: 'long', usage: USAGE } }
    })
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: 'claude-opus-5-5', agentId: 'a6', teammateId: 'scout@team' }
    })
    await $.agent.spawn(spawnInput({ isTeammate: true, background: true, name: 'scout' }))
    expect(spawnedOn).toBe(undefined)
    expect(classified).toBe(false)
  })
})

describe('risk floor and rate limits: pure rules', () => {
  test('routeTier', async () => {
    expect(routeTier('simple', 'builder', false, { risky: true })).toBe('hard')
    // the risk floor goes past the runner's cap
    expect(routeTier('simple', 'runner', false, { risky: true })).toBe('hard')
    expect(routeTier('hard', 'builder', false, { underPressure: true })).toBe('standard')
    expect(routeTier('long', 'builder', true, { underPressure: true })).toBe('hard')
    expect(routeTier('long', 'builder', true)).toBe('long')
    // role floors hold under pressure
    expect(routeTier('standard', 'architect', false, { underPressure: true })).toBe('standard')
    // risk wins over pressure
    expect(routeTier('hard', 'builder', false, { risky: true, underPressure: true })).toBe('hard')
    expect(routeTier('simple', 'builder', false, { underPressure: true })).toBe('simple')
  })

  test('the act is risky, not the subject', async () => {
    expect(parseRisky('hard risky')).toBe(true)
    expect(parseRisky('standard')).toBe(false)
    expect(looksRisky('Deploy the new build to production')).toBe(true)
    expect(looksRisky('run DROP TABLE users on the shared db')).toBe(true)
    expect(looksRisky('git push --force origin main')).toBe(true)
    expect(looksRisky('Add a refund endpoint that calls Stripe')).toBe(false)
    expect(looksRisky('Write tests for the production config loader')).toBe(false)
    expect(looksRisky('Rename the deploy script')).toBe(false)
  })
})

/** Answers `$.session.usage()` with one five-hour window at `percent`. */
function limitsAt(on: any, percent: number) {
  on('session.usage', async () => ({
    value: { startedAt: 0, context: {} as never, rateLimits: [{ kind: 'five_hour', percentUsed: percent }] },
  }))
}

describe('risk floor and rate limits', () => {
  test('a risky simple task runs on Opus', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple risky', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'r1' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-opus-5-5')
  })

  test('without a classifier, a destructive act still gets the floor', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: {
      isAnswered: false as const,
      reason: 'api-error' as const,
      status: 529,
      error: 'overloaded' as const,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } }))
    on('model.classify', async () => ({ value: 'simple' }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'r2' }
    })
    await $.agent.spawn(spawnInput({ subagentType: 'model-router:runner', prompt: 'Deploy the release to production now' }))
    expect(spawnedOn).toBe('claude-opus-5-5')
  })

  test('the risk floor can be turned off', { options: { riskFloor: false } }, async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple risky', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'r3' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-haiku-5-5')
  })

  test('past 80% of a rate-limit window, a hard task runs on Sonnet', async ($, on) => {
    mock.clock(on)
    limitsAt(on, 85)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'hard', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'p1' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-sonnet-5-5')
  })

  test('an unattended run goes to Opus, not Fable, under rate-limit pressure', async ($, on) => {
    mock.clock(on)
    limitsAt(on, 85)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'long', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'p5' }
    })
    await $.agent.spawn(spawnInput({ prompt: 'Run the whole migration unattended overnight', description: 'migration' }))
    expect(spawnedOn).toBe('claude-opus-5-5')
  })

  test('below the threshold, nothing changes', async ($, on) => {
    mock.clock(on)
    limitsAt(on, 79)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'hard', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'p2' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-opus-5-5')
  })

  test('with the setting off, rate limits are ignored', { options: { limitPressure: 'off' } }, async ($, on) => {
    mock.clock(on)
    limitsAt(on, 99)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'hard', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'p3' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-opus-5-5')
  })

  test('a risky task keeps Opus under rate-limit pressure', async ($, on) => {
    mock.clock(on)
    limitsAt(on, 95)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'standard risky', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'p4' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-opus-5-5')
  })
})

describe('effort', () => {
  test('a simple task asks for low effort', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'e1' }))
    const seen = captureEffort(on)
    await $.agent.spawn(spawnInput())
    await step($, 'e1', 'high')
    expect(seen.effort).toBe('low')
  })

  test('the first request gets low effort even when it arrives before the spawn answers', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    let entered!: () => void
    const spawnEntered = new Promise<void>(r => (entered = r))
    let release!: () => void
    const spawnReleased = new Promise<void>(r => (release = r))
    on('agent.spawn', async (_$, e) => {
      entered()
      await spawnReleased
      return { model: e.model ?? '', agentId: 'race1' }
    })
    const seen = captureEffort(on)
    const spawning = $.agent.spawn(spawnInput())
    await spawnEntered
    // The agent's first request, sent while the spawn hook is still waiting on `next`.
    const stepping = step($, 'race1', 'high')
    release()
    await Promise.all([spawning, stepping])
    expect(seen.effort).toBe('low')
  })

  test('a hard task keeps the effort it had', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'hard', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'e2' }))
    const seen = captureEffort(on)
    await $.agent.spawn(spawnInput())
    await step($, 'e2', 'xhigh')
    expect(seen.effort).toBe('xhigh')
  })

  test('a model without effort is not given one', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'e3' }))
    const seen = captureEffort(on)
    await $.agent.spawn(spawnInput())
    await step($, 'e3', undefined)
    expect(seen.effort).toBe(undefined)
  })

  test('an Agent call that sets its own effort keeps it', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'e4' }))
    on('tool.call', { tool: 'Agent' }, async () => ({ result: 'started' as never }))
    const seen = captureEffort(on)
    // In a session the spawn runs inside the Agent call; here it follows it.
    await $.tool.call({ tool: 'Agent', tool_use_id: 'tu9', description: 'rename', prompt: 'rename x', effort: 'high' } as never)
    await $.agent.spawn(spawnInput({ tool_use_id: 'tu9' }))
    await step($, 'e4', 'high')
    expect(seen.effort).toBe('high')
  })
})

describe('/router modes', () => {
  test('off leaves spawns alone and asks no classifier', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let spawnedOn: string | undefined = 'unset'
    let classified = false
    on('model.complete', async () => {
      classified = true
      return { value: { isAnswered: true as const, text: 'simple', usage: USAGE } }
    })
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: 'claude-opus-5-5', agentId: 'm1' }
    })
    await $.command.run({ command: 'router', args: 'off' } as never)
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe(undefined)
    expect(classified).toBe(false)
  })

  test('sonnet sends every routed spawn to Sonnet 5.5 without classifying', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let spawnedOn: string | undefined
    let classified = false
    on('model.complete', async () => {
      classified = true
      return { value: { isAnswered: true as const, text: 'simple', usage: USAGE } }
    })
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'm2' }
    })
    await $.command.run({ command: 'router', args: 'sonnet' } as never)
    await $.agent.spawn(spawnInput({ subagentType: 'model-router:runner' }))
    expect(spawnedOn).toBe('claude-sonnet-5-5')
    expect(classified).toBe(false)
  })

  test('a mode saved in an earlier session is used', async ($, on) => {
    mock.clock(on)
    mock.store(on, { mode: 'haiku' })
    let spawnedOn: string | undefined
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'm3' }
    })
    await $.agent.spawn(spawnInput({ subagentType: 'model-router:architect' }))
    expect(spawnedOn).toBe('claude-haiku-5-5')
  })
})

describe('classifier fallback', () => {
  test('when Haiku 4.5 fails, the built-in classifier picks the tier', async ($, on) => {
    mock.clock(on)
    let spawnedOn: string | undefined
    on('model.complete', async () => ({ value: {
      isAnswered: false as const,
      reason: 'api-error' as const,
      status: 404,
      error: 'not_found' as never,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } }))
    on('model.classify', async () => ({ value: 'hard' }))
    on('agent.spawn', async (_$, e) => {
      spawnedOn = e.model
      return { model: e.model ?? '', agentId: 'c1' }
    })
    await $.agent.spawn(spawnInput())
    expect(spawnedOn).toBe('claude-opus-5-5')
  })
})

/** Answers every model request with 2k tokens in and 1k out, on `model`. */
function answerSteps(on: any, model: string) {
  on('turn.step', async function* (_$: unknown, e: any) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'done',
      toolUses: [],
      stopReason: 'end_turn' as never,
      usage: { ...USAGE, input_tokens: 2000, model },
    }
  })
}

function mountPane($: any, bodyColumns = 70) {
  return $.ui.mount({
    plugin: 'model-router',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'model-router',
    props: { title: 'Model router', isFocused: false, bodyColumns, placement: 'dock' } as never,
  })
}

/** What the engine draws in the band and how it ends a turn, beneath the plugins. */
function engineBeneath(on: any) {
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', children: [] }))
  on('turn.complete', async (_$: unknown, e: any) => ({ text: e.answer }))
  on('session.end', async (_$: unknown, e: any) => ({ sessionId: e.sessionId }))
}

function mountBand($: any) {
  return $.ui.mount({
    plugin: 'model-router',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80 } as never,
  })
}

/** Ends a run of subagent `agentId`, as its loop's turn.complete does. */
function complete($: any, agentId: string) {
  return $.turn.complete({ agentId, turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
}

describe('bill', () => {
  test('a routed step is priced on Haiku 5.5 and against the builder on Sonnet', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'a1' }))
    answerSteps(on, 'claude-haiku-5-5')
    await $.agent.spawn(spawnInput())
    await step($, 'a1', undefined)

    // 2k in + 1k out: Haiku 5.5 $0.0007, Sonnet 5.5 (the builder's registered model) $0.014;
    // the Haiku 4.5 classifier call adds $0.006, so $0.0067 against $0.014 is 52% saved
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: 'Model router · on' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Spent <\$0\.01$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Unrouted \$0\.01\s+saved 52%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'rename fooBar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^easy$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Haiku$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 agent · 1 routed · classifier <\$0\.01$/ })).toBeDefined()
    // no risky or lowered row, so no legend for them
    expect(await ui.find({ type: 'Text', text: /risky/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /rate limits/ })).toBe(undefined)
    await ui.unmount()
  })

  test('with no subagents the pane says how to get one', async ($, on) => {
    mock.clock(on)
    const ui = await mountPane($)
    expect(
      await ui.find({ type: 'Text', text: 'No subagents yet. Ask Claude to use an agent and it shows up here.' }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Agent$/ })).toBe(undefined)
    await ui.unmount()
  })

  test('a narrow pane keeps the money columns whole and truncates the agent name', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'n1' }))
    answerSteps(on, 'claude-haiku-5-5')
    await $.agent.spawn(spawnInput({ description: 'rename every fooBar reference across the whole monorepo' }))
    await step($, 'n1', undefined)
    const ui = await mountPane($, 40)
    // Sonnet 5.5 $0.014 unrouted, Haiku 5.5 $0.0007 routed plus $0.006 for the classifier: 52% saved
    expect(await ui.find({ type: 'Text', text: /^Unrouted \$0\.01\s+saved 52%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Unrouted$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$0\.01$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^<\$0\.01$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Cost$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Model$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Tier$/ })).toBeDefined()
    // the agent name is cut with an ellipsis, not the money columns
    expect(await ui.find({ type: 'Text', text: /…$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'rename every fooBar reference across the whole monorepo' })).toBe(undefined)
    // the pane fits the 40 columns (2 of them the gutter), each row adds up to the pane, and only Agent is flexible
    const pane = await ui.drawn() as any
    const table = pane.children.find((c: any) => c.type === 'Box' && c.children?.some((r: any) => r.props?.flexDirection === 'row'))
    expect(pane.props.width).toBeLessThanOrEqual(40 - 2)
    for (const row of table.children.filter((r: any) => r.props?.flexDirection === 'row')) {
      expect(row.children.reduce((sum: number, cell: any) => sum + cell.props.width, 0)).toBe(pane.props.width)
      for (const cell of row.children.slice(1)) expect(cell.props.flexShrink).toBe(0)
    }
    await ui.unmount()
  })

  test('a risky row shows hard! and the legend explains it', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple risky', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'k1' }))
    answerSteps(on, 'claude-opus-5-5')
    await $.agent.spawn(spawnInput())
    await step($, 'k1', undefined)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^hard!$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '! risky: sent to Opus at least' })).toBeDefined()
    await ui.unmount()
  })
})

describe('baseline for built-in agents', () => {
  test('a routed Explore is compared with the model Explore was seen running on', async ($, on) => {
    mock.clock(on)
    mock.store(on, { agentModels: { Explore: 'claude-haiku-5-5' } })
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'standard', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'x1' }))
    answerSteps(on, 'claude-sonnet-5-5')
    await $.agent.spawn(spawnInput({ subagentType: 'Explore', description: 'find callers' }))
    await step($, 'x1', undefined)
    const ui = await mountPane($)
    // Sonnet 5.5 $0.014 against Haiku 5.5 $0.0007, not the parent's Opus $0.028
    expect(await ui.find({ type: 'Text', text: /^Unrouted <\$0\.01\s+\d+% more$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$0\.03$/ })).toBe(undefined)
    await ui.unmount()
  })

  test('the model an unrouted Explore ran on becomes its baseline', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'standard', usage: USAGE } }))
    let n = 0
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? 'claude-haiku-5-5', agentId: `y${++n}` }))
    answerSteps(on, 'claude-sonnet-5-5')
    await $.command.run({ command: 'router', args: 'off' } as never)
    await $.agent.spawn(spawnInput({ subagentType: 'Explore', description: 'find callers' }))
    await $.command.run({ command: 'router', args: 'on' } as never)
    await $.agent.spawn(spawnInput({ subagentType: 'Explore', description: 'find callees' }))
    await step($, 'y2', undefined)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^Unrouted <\$0\.01/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$0\.03$/ })).toBe(undefined)
    await ui.unmount()
  })
})

describe('baseline for router roles', () => {
  test('a routed role is compared with Sonnet, its registered model, not the parent Opus', async ($, on) => {
    mock.clock(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'standard', usage: USAGE } }))
    let n = 0
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: `b${++n}` }))
    answerSteps(on, 'claude-sonnet-5-5')
    await $.agent.spawn(spawnInput())
    await step($, 'b1', undefined)
    let ui = await mountPane($)
    // the builder's step: Sonnet $0.014 against Sonnet $0.014; on Opus it would be $0.028
    expect(await ui.findAll({ type: 'Text', text: /^\$0\.01$/ })).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: /^Unrouted \$0\.01/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$0\.03$/ })).toBe(undefined)
    await ui.unmount()

    await $.agent.spawn(spawnInput({ subagentType: 'model-router:fixer', description: 'fix login' }))
    await step($, 'b2', undefined)
    ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^Unrouted \$0\.03/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$0\.03$/ })).toBe(undefined)
    await ui.unmount()
  })
})

describe('band above the prompt', () => {
  test('a routed subagent has a line until 30 seconds after it finishes', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'a1' }))
    answerSteps(on, 'claude-haiku-5-5')
    await $.agent.spawn(spawnInput())
    await step($, 'a1', undefined)
    const ui = await mountBand($)
    expect(await ui.find({ type: 'Text', text: /⇄ builder: rename fooBar → Haiku · / })).toBeDefined()
    await complete($, 'a1')
    await clock.advance(29_000)
    expect(await ui.find({ type: 'Text', text: /⇄ builder: rename fooBar/ })).toBeDefined()
    await clock.advance(2_000)
    expect(await ui.find({ type: 'Text', text: /⇄/ })).toBe(undefined)
    await ui.unmount()
  })

  test('SubagentStop finishes the line too', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on)
    on('classic.SubagentStop', async () => ({}))
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'a1' }))
    answerSteps(on, 'claude-haiku-5-5')
    await $.agent.spawn(spawnInput())
    await step($, 'a1', undefined)
    const ui = await mountBand($)
    await $.classic.SubagentStop({
      agent_id: 'a1',
      agent_type: 'model-router:builder',
      agent_transcript_path: '',
      stop_hook_active: false,
    } as never)
    await clock.advance(29_000)
    // a turn.complete for the same run does not restart the fade
    await complete($, 'a1')
    await clock.advance(2_000)
    expect(await ui.find({ type: 'Text', text: /⇄/ })).toBe(undefined)
    await ui.unmount()
  })

  test('an unrouted subagent has no line', async ($, on) => {
    mock.clock(on)
    engineBeneath(on)
    on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'f1' }))
    answerSteps(on, 'claude-opus-5-5')
    await $.agent.spawn(spawnInput({ fork: true, subagentType: 'fork' }))
    await step($, 'f1', undefined)
    const ui = await mountBand($)
    expect(await ui.find({ type: 'Text', text: /⇄/ })).toBe(undefined)
    await ui.unmount()
  })
})

describe('/clear', () => {
  test('a row wiped while its agent runs is written again from the spawn', async ($, on) => {
    mock.clock(on)
    engineBeneath(on)
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'a1' }))
    answerSteps(on, 'claude-haiku-5-5')
    await $.agent.spawn(spawnInput())
    // what /clear does to $.state, as far as the ledger goes
    await $.command.run({ command: 'router', args: 'reset' } as never)
    await step($, 'a1', undefined)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: 'rename fooBar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^easy$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'subagent' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /1 routed/ })).toBeDefined()
    await ui.unmount()
    const band = await mountBand($)
    expect(await band.find({ type: 'Text', text: /⇄ builder: rename fooBar → Haiku/ })).toBeDefined()
    await band.unmount()
  })
})

describe('status line', () => {
  test('updates when a subagent finishes and resets on /clear', async ($, on) => {
    mock.clock(on)
    engineBeneath(on)
    const seen: (string | undefined)[] = []
    on('ui.status', async (_$, e) => {
      seen.push(e.text)
      return { value: undefined }
    })
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'simple', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'a1' }))
    answerSteps(on, 'claude-haiku-5-5')
    await $.agent.spawn(spawnInput())
    await step($, 'a1', undefined)
    await complete($, 'a1')
    expect(seen.at(-1)).toContain('$')
    expect(seen.at(-1)).toContain('saved')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
    expect(seen.at(-1)).toBe(undefined)
  })

  test('says how much more when routing cost more than the baseline', async ($, on) => {
    mock.clock(on)
    mock.store(on, { agentModels: { Explore: 'claude-haiku-5-5' } })
    engineBeneath(on)
    const seen: (string | undefined)[] = []
    on('ui.status', async (_$, e) => {
      seen.push(e.text)
      return { value: undefined }
    })
    on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'standard', usage: USAGE } }))
    on('agent.spawn', async (_$, e) => ({ model: e.model ?? '', agentId: 'x1' }))
    answerSteps(on, 'claude-sonnet-5-5')
    await $.agent.spawn(spawnInput({ subagentType: 'Explore', description: 'find callers' }))
    await step($, 'x1', undefined)
    await complete($, 'x1')
    // Sonnet 5.5 against Explore's own Haiku 5.5 costs more, so no negative "saved"
    expect(seen.at(-1)).toMatch(/\(\d+% more\)/)
    expect(seen.at(-1)).not.toContain('saved')
  })
})

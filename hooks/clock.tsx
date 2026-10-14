// A running agent's clock for the /router pane. It ticks on the surface's own frame clock, so
// the pane is not drawn again every second. The idea comes from claude-flightdeck's elapsed
// clock (MIT, Stephen Casella).
import type { ClientModule } from 'claude-code'

/** Kept here, not imported: a surface module runs on its own, apart from the hooks module. */
function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

type Props = { since: number; now: number; endAt: number | null }
type Ref = { base: number; ticks: number; lastNow: number; isRunning: boolean }
type State = { ref: Ref }

const Clock: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { base: 0, ticks: 0, lastNow: -1, isRunning: true }
  if (props.now !== ref.lastNow) {
    // A fresh reading from the hooks module: count on from it.
    ref.lastNow = props.now
    ref.base = (props.endAt ?? props.now) - props.since
    ref.ticks = 0
  }
  ref.isRunning = props.endAt === null
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(1000, () => {
      if (ref.isRunning) {
        ref.ticks += 1
        surface.setState({ ref })
      }
    })
  }
  return <Text dimColor={!ref.isRunning}>{clockText(ref.base + ref.ticks * 1000)}</Text>
}

export default Clock

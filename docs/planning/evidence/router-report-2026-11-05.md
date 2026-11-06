# Model router report 2026-11-05

- Total spend: $1,055.67 at list price (main conversations $514.06, subagents $541.60).
- Routed share: 117 of 221 runs ($322.63 of $541.60 subagent spend); named by caller 51, default 53.
- Saved against all-Opus (subagents): $41.83 (7%) - the same tokens on Opus cost $583.44.
- Main conversations: $514.06, of which Opus $454.05 (88%). The same Opus tokens on Sonnet would cost $227.02 (difference $227.02); subagent routing does not touch this.
- Rescues: 1. Redos: 0. High tool-failure runs: 0.

## Spend by model

| Model | Main | Subagents |
| --- | --- | --- |
| claude-haiku-4-5-20251001 | $11.80 | $0.00 |
| claude-haiku-5-5 | $0.03 | $0.34 |
| claude-opus-5-5 | $454.05 | $503.59 |
| claude-sonnet-4-6 | $48.19 | $0.00 |
| claude-sonnet-5-5 | $0.00 | $37.67 |

## Rescues (moved to a stronger model mid-run)

- general-purpose: Oct 26 All Staff (claude-sonnet-5-5,claude-opus-5-5) /home/brian/.claude/projects/-home-brian-code/6e959d3d-74bf-453a-9932-f2b92762337f/subagents/agent-a6e3dc527e31c3466.jsonl

## Redos (a stronger model repeated an earlier run)

None.

## High tool-failure runs

None.

## Five costliest runs

- $28.71 general-purpose: Ingest Lockstep docs into its wiki (claude-opus-5-5, routed) /home/brian/.claude/projects/-home-brian-code/a769ac09-c3c5-4e07-b22e-1929ed2c739d/subagents/agent-a3cc9c3138a366f49.jsonl
- $24.23 general-purpose: Shared caching, batching, parallel calls (claude-opus-5-5, routed) /home/brian/.claude/projects/-home-brian-code/47a41ca7-0e7d-45c0-9dbe-5b5927617a98/subagents/agent-a1ad96c9324882a8f.jsonl
- $17.59 general-purpose: Fix planning gate; ship Lockstep docs (claude-opus-5-5, routed) /home/brian/.claude/projects/-home-brian-code/a769ac09-c3c5-4e07-b22e-1929ed2c739d/subagents/agent-a2728dc2b404a263c.jsonl
- $16.35 general-purpose: Team-Brains planning package and wiki (claude-opus-5-5, default) /home/brian/.claude/projects/-home-brian-code/6e959d3d-74bf-453a-9932-f2b92762337f/subagents/agent-a7ad662ccedd4cf7b.jsonl
- $15.49 general-purpose: Build bot answers in Team-Brains (claude-opus-5-5, routed) /home/brian/.claude/projects/-home-brian-code/6e959d3d-74bf-453a-9932-f2b92762337f/subagents/agent-ae637673aa5a9b240.jsonl

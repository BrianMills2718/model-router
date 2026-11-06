# Router weekly review 2026-W45

Days 2026-11-02 to 2026-11-08: 302 subagent runs with an outcome, 4 with a bad outcome (failed tools, rescued, redone or fixed after).

A clean week is weak evidence: these signals catch loud failure (retries, fixers, rescues, failed tools), not a wrong answer nobody noticed. Read the sampled traces before lowering anything.

## Outcome by agent type and tier

| Agent type | Tier | Runs | Bad | Rate | Cost |
| --- | --- | --- | --- | --- | --- |
| bulk-worker | simple | 1 | 0 | 0% | $0.00 |
| claude-code-guide | standard | 1 | 0 | 0% | $0.62 |
| company-planning:planning-compliance-reviewer | hard | 35 | 0 | 0% | $83.12 |
| company-planning:planning-compliance-reviewer | standard | 44 | 2 | 5% | $19.52 |
| debugger | hard | 2 | 0 | 0% | $13.88 |
| fork | hard | 2 | 0 | 0% | $11.71 |
| frontend | hard | 2 | 0 | 0% | $7.44 |
| frontend | standard | 1 | 0 | 0% | $0.89 |
| general-purpose | hard | 116 | 0 | 0% | $494.35 |
| general-purpose | simple | 7 | 0 | 0% | $0.33 |
| general-purpose | standard | 48 | 2 | 4% | $38.85 |
| model-router:builder | hard | 8 | 0 | 0% | $42.84 |
| model-router:builder | standard | 3 | 0 | 0% | $1.72 |
| publish-checker | hard | 1 | 0 | 0% | $0.46 |
| publish-checker | standard | 3 | 0 | 0% | $0.47 |
| researcher | hard | 4 | 0 | 0% | $3.95 |
| researcher | standard | 8 | 0 | 0% | $4.73 |
| reviewer | hard | 5 | 0 | 0% | $5.47 |
| reviewer | standard | 4 | 0 | 0% | $1.04 |
| web-fetch | simple | 7 | 0 | 0% | $0.02 |

## Decisions proposed

### Decision 2026-W45-1: Lower general-purpose from hard to standard

- Status: proposed (a session that reads this accepts or rejects it, and records which).
- Evidence: 0 of 116 runs had a bad outcome (0%), cost $494.35 at list price.
- Read these traces before deciding: none, no bad runs
- Source: inferred by agent: thresholds from the #162 research report, section 6 (review loop).


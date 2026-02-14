# AI Game Master Activation Plan

## Current baseline (already in code)

- Server runs a deterministic director loop in `apps/server/src/game-loop.ts` (`runDirector`, `runIncursionDirector`).
- Existing broadcast path is `director_event` (plus `dynamic_objectives`/`objective_completed`).
- Event kinds currently supported in shared protocol: `weather_shift`, `supply_drop`, `reinforcement_wave`, `objective_shift`, `artillery_warning`, `dynamic_objective`.
- This deterministic loop is the mandatory fallback path and should remain enabled even after LLM integration.

## Objective

Introduce an LLM-backed AI Game Master that proposes events every 60s with strict server guardrails, while preserving deterministic fallback for reliability, fairness, and cost control.

## Architecture (phase-target)

1. State Aggregator (server-only)
   - Build `DirectorStateSummary` snapshots from live game state (scores, tickets, capture pressure, kill momentum, active objectives, weather, time remaining).
   - Keep summary compact and schema-stable so prompts are deterministic and testable.

2. AI Director Service (server-only)
   - New module (suggested: `apps/server/src/director/ai-director-service.ts`).
   - Input: `DirectorStateSummary` + config.
   - Output: `AiDirectorDecision` (0-2 proposed events + optional rationale + next check hint).
   - Hard timeout: 2500ms. On timeout/error, return `null` and continue fallback path.

3. Event Compiler + Guardrails (server-only)
   - Convert AI proposals into allowed `DirectorEvent` values.
   - Validate each event against hard rules before execution.
   - Reject invalid/unsafe proposals and record rejection reason.

4. Director Orchestrator (inside game loop)
   - On cadence tick: try AI path first when enabled.
   - If AI disabled/fails/rejected: run existing deterministic logic.
   - Always emit telemetry for chosen path (`ai`, `fallback`, `mixed`).

5. Observability
   - Structured logs per tick with: summary hash, provider latency, chosen events, reject reasons, fallback reason.
   - Persist optional match-level event log for post-match tuning.

## Event safety policy (MVP)

- Max 2 events per AI check.
- Global cooldown: 60s between major events (`artillery_warning`, `objective_shift`, future `airstrike`).
- No direct player targeting.
- Rubber-band constraints: cannot stack punishments on the trailing team.
- Zone validation: must map to existing capture/objective zones.
- Weather coherence: avoid repeating current weather.
- Budget limits: cap total high-impact events per match.

## Data contracts (new)

```ts
interface DirectorStateSummary {
  matchId: string;
  gameMode: 'conquest' | 'incursion' | 'rush' | 'tdm';
  elapsedSec: number;
  remainingSec: number;
  tickets: { alpha: number; bravo: number };
  scores?: { alpha: number; bravo: number };
  capture: Array<{ id: string; owner: number; contested: boolean }>;
  momentum: { alphaKills60s: number; bravoKills60s: number; leadingTeam: number | -1 };
  activeObjectives: Array<{ id: string; zone: string; timeRemaining: number; targetTeam: number }>;
  weather: string;
}

interface AiDirectorDecision {
  events: Array<{
    kind: 'weather_shift' | 'supply_drop' | 'reinforcement_wave' | 'objective_shift' | 'artillery_warning';
    zone?: string;
    team?: number;
    weather?: string;
    durationSeconds?: number;
    title?: string;
    description?: string;
  }>;
  rationale?: string;
  nextCheckSeconds?: number;
}
```

## Rollout phases

### Phase 0: Internal scaffolding (no gameplay change)

- Add director module boundaries (`state-summary`, `ai-service`, `event-compiler`, `policy`).
- Add feature flags:
  - `AI_DIRECTOR_ENABLED=false`
  - `AI_DIRECTOR_PROVIDER=none|openclaw|anthropic`
  - `AI_DIRECTOR_TIMEOUT_MS=2500`
- Add synthetic unit tests for compiler and policy.

Exit criteria:
- Server behavior unchanged with flags off.
- New modules compile and tests pass.

### Phase 1: Shadow mode (AI read-only)

- AI service runs on cadence but does not affect gameplay.
- Compare AI proposals vs fallback choices in logs.
- Track latency and parse success rate.

Exit criteria:
- >=95% valid AI payloads.
- p95 latency <=2500ms.
- No server tick hitches or networking regressions.

### Phase 2: Guarded live mode

- Enable AI event execution behind policy compiler.
- Keep deterministic fallback always available per tick.
- Start with low-impact events only: weather + supply + objective shift.

Exit criteria:
- No fairness regressions in sampled matches.
- Reject path behaves safely.
- Fallback activates cleanly on provider failure.

### Phase 3: Expanded catalog + balancing

- Add higher-impact events (artillery variants, advanced dynamic objective variants).
- Add map-aware constraints and anti-repeat pacing memory.
- Tune prompt and policy thresholds from telemetry.

Exit criteria:
- Stable engagement metrics and match completion quality.
- Ops confidence for default-on in Incursion.

## Testing plan

- Unit:
  - Policy validation for each event kind.
  - Compiler rejects malformed zones/team ids/weather states.
  - Timeout/error fallback behavior.
- Integration:
  - Simulated tick loop with fake provider responses (valid, invalid, timeout).
  - Assert expected broadcasts and fallback transitions.
- Manual:
  - Two-client local match in Incursion with shadow mode first, then guarded live mode.

## Immediate implementation checklist

- [ ] Create `apps/server/src/director/` module with summary builder, policy, compiler, AI service interface.
- [ ] Add provider abstraction and env-driven wiring.
- [ ] Integrate orchestrator path into `runDirector` / `runIncursionDirector` without removing fallback.
- [ ] Add metrics/logging envelope for per-tick director decisions.
- [ ] Add tests for policy/compiler/fallback flows.
- [ ] Run `pnpm --filter @clawfield/server build` and targeted test command(s).

## Notes

- Keep gameplay authority fully server-side; AI only proposes intents.
- Do not allow AI-generated freeform voxel edits directly in Phase 1/2.
- Keep deterministic fallback as a permanent reliability layer, not a temporary migration crutch.

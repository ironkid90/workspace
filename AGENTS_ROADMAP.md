# Multi-Agent System Roadmap

Execution plan and status for `codex-orch`.

## Phase 1: Robustness
- [x] Absolute workspace resolution
- [x] Autonomous run loop with round/event tracking
- [x] Implementer/auditor role split
- [x] Stable local + demo execution modes

## Phase 2: Advanced Verification
- [x] Secret scanner integrated in verifier layer
- [x] Lint loop runs after Worker-1 tracked changes
- [x] Coordinator ensemble voting (3 parallel variants + majority pick)

## Phase 3: Dynamic Context
- [x] Context compression (`first/last` strategy) before prompt injection
- [x] Heuristic selector to skip auditor when no tracked file changes exist
- [x] Research role with local documentation/code search injection
- [ ] External web-search adapter with source ranking

## Phase 4: Recovery and Human Control
- [x] Round checkpoint creation
- [x] Manual rewind capability
- [x] Auto-rewind trigger on critical regression conditions
- [x] Pause/resume controls for human-in-the-loop gating
- [x] Fine-grained “approve next action” gate before each agent act

## Phase 5: Platform Expansion (Planned)
- [ ] Workflow graph DSL (explicit node/edge registry)
- [ ] Persisted run history index for cross-run analytics
- [ ] Python/.NET orchestration port for Microsoft Agent Framework parity
- [ ] OpenTelemetry export for distributed tracing

## Phase 6: Operator Experience
- [x] Unified CLI (`setup`, `run`, `deploy`) with local filesystem-safe orchestration
- [x] One-click Vercel deploy command path
- [x] Interactive auth/API onboarding flow for required tools and providers
- [x] Gemini provider support through API key or Google ADC login

## Current delivery summary
- Backend: implemented through `lib/swarm/engine.ts`, `lib/swarm/store.ts`, `lib/swarm/types.ts`.
- APIs: `start`, `state`, `stream`, `control`.
- UI: MGX-style operations board with feature toggles, pause/resume/rewind, events, messages, checkpoints, lint and ensemble outcomes.

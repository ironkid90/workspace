# Multi-Agent System Architecture

This architecture reflects the current implementation in `codex-orch` and the next extension path.

## 1. Orchestration Topology

### Current model (implemented)
- Fan-out/fan-in rounds:
  - `Research` (context gathering)
  - `Worker-1` (implementation)
  - `Worker-2` (auditor, conditionally invoked)
  - `Evaluator` (quality/process feedback)
  - `Coordinator` (single or ensemble voting)
- Runtime controls:
  - `pause` / `resume`
  - checkpoint `rewind`
- Execution modes:
  - `local` (Codex subprocess execution)
  - `demo` (deterministic simulation; default on Vercel)
- Operator surfaces:
  - Web dashboard (SSE + API control plane)
  - CLI control plane (`scripts/swarm-cli.ts`) with pause/resume/rewind/status

### Planned model (next)
- Explicit workflow graph object (node/edge definitions, dynamic branching metadata).
- Optional cross-project routers for domain-specific agent pools.

## 2. Agent Lifecycle (PDA)

Each agent state includes `pdaStage` transitions:
1. `perceive`
2. `decide`
3. `act`

This is emitted to the event stream and shown in the dashboard for live observability.

## 3. Communication & State

### Structured Message Schema (`runs/round-*/messages.jsonl`)
- `timestampUtc`
- `round`
- `from`
- `to`
- `type` (`task`, `result`, `feedback`, `error`, `control`)
- `summary`
- `artifactPath` (optional)
- `sha256` (optional)

### Central run state
Run state stores:
- agent status and excerpts
- round summaries
- lint outcomes
- ensemble outcomes
- checkpoint catalog
- structured messages
- event timeline
- provider/auth-aware runtime configuration (`.env.local` driven)

## 4. Verification Layers

1. Deterministic verification:
- secret-pattern scanner
- markdown/JSON-structure sanity checks
- changed-file detection

2. Functional verification:
- lint loop (`npm run lint`) after `Worker-1` changes
- command exit-code gating

3. Cognitive verification:
- `Worker-2` audit verdict (`APPROVE` / `REJECT`)
- `Evaluator` status (`PASS` / `FAIL`)
- coordinator final status merge

## 5. Checkpoint & Recovery

- A checkpoint is created each round in `runs/checkpoints/round-*`.
- On critical regression, runtime can auto-rewind to previous checkpoint.
- Operator can manually rewind via API/UI when paused.

## 6. Human-in-the-Loop Controls

- Pause/resume is available through `/api/swarm/control`.
- Rewind requires a paused run for safety.
- Dashboard surfaces pause state, checkpoint inventory, and rewind actions.

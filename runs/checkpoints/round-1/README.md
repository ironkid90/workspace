# Codex Swarm Orchestrator + Live Dashboard

This repository now includes a real-time swarm dashboard with:

- Fan-out/fan-in execution loop:
- `Research` + `Worker-1` + `Evaluator` run each round.
- `Worker-2` (Auditor) runs conditionally via heuristic selector.
- `Coordinator` can run in 3-variant ensemble voting mode.
- Evaluator feedback and research context are injected into the next round.
- Live status streaming:
- SSE stream at `api/swarm/stream`.
- Snapshot API at `api/swarm/state`.
- Start API at `api/swarm/start`.
- Control API at `api/swarm/control` for pause/resume/rewind.
- MGX-style operations UI:
- Agent cards with phase + excerpts.
- Round decision panel.
- Activity timeline + structured agent messages.
- Checkpoints, lint results, and ensemble outcomes.
- Unified CLI for setup, run, and deploy flows.

## Architecture

- `run-swarm.ps1` remains available.
- New runtime lives in `lib/swarm/engine.ts`.
- Parsing/verification utilities:
- `lib/swarm/parse.ts` for status/decision extraction.
- `lib/swarm/verifier.ts` for deterministic safety checks.
- `runs/round-*/messages.jsonl` for structured inter-agent communication.
- UI + APIs:
- `app/page.tsx`
- `app/api/swarm/*`

## Localhost

1. Install dependencies:
```bash
npm install
```

2. Start the app:
```bash
npm run dev
```

3. Open:
```text
http://localhost:3000
```

4. Click **Start swarm**.

Optional environment bootstrap:
```bash
cp .env.example .env.local
```

## CLI Mode (No GUI Required)

The same runtime features are available from terminal:

```bash
npm run swarm:setup
npm run swarm:run -- --mode local --max-rounds 3
```

Or via PowerShell entrypoint:

```powershell
.\run-swarm.ps1              # advanced CLI mode
.\run-swarm.ps1 -Setup       # auth/API setup
.\run-swarm.ps1 -Deploy      # one-click Vercel preview deploy
.\run-swarm.ps1 -Legacy      # old direct script path
```

Interactive terminal controls during `swarm:run`:
- `pause`
- `resume`
- `rewind <round>`
- `status`

Notes:

- `local` mode executes Codex CLI commands directly.
- `demo` mode simulates agent outputs for UI/testing.
- On critical regression, checkpoint rewind can trigger automatically.
- Codex executable override:
```bash
SWARM_CODEX_BIN=codex
```

Gemini provider options (optional):
- API key mode:
```bash
SWARM_RESEARCH_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3-pro
```
- Google login mode:
```bash
SWARM_RESEARCH_PROVIDER=gemini
GOOGLE_USE_ADC=1
GEMINI_MODEL=gemini-3-pro
```
When `GOOGLE_USE_ADC=1`, the runtime attempts:
`gcloud auth application-default print-access-token`.

## Vercel

Deploy as a standard Next.js project.

One-click preview deploy:
```bash
npm run swarm:deploy
```

Production deploy (explicit):
```bash
npm run swarm:deploy -- --prod
```

- On Vercel, the app defaults to `demo` mode for safe execution.
- The full local runner (spawning Codex subprocesses) is intended for local environments.

## Advanced patterns incorporated

- Fan-out/fan-in orchestration pattern from the `agent-framework-new` workflow samples.
- Deterministic selector/verifier style safeguards inspired by `multiagent/azuredev-4c13`.
- Reflection loop via evaluator feedback propagated into subsequent rounds.

# Multi-Agent Project Dependencies

## Runtime stack (current)
- `next@16.1.6`
- `react@19.2.4`
- `react-dom@19.2.4`
- `typescript@5.8.3`
- `tsx@4.20.6` (CLI execution for setup/run/deploy tooling)
- `@types/node`, `@types/react`, `@types/react-dom`

## Built-in platform primitives used
- Node `child_process`: agent/lint/research subprocess execution
- Node `fs/promises`: checkpointing, artifact and message persistence
- Node `crypto`: SHA-256 integrity hashes for structured messages
- Node `events`: in-memory realtime event fan-out

## Tooling contracts
- `codex` CLI: local agent execution in `local` mode
- `npm run lint`: lint loop gate (configured as `tsc --noEmit`)
- `npm run build`: production validation gate
- `rg` (optional but preferred): local research search acceleration
- `npx vercel`: one-click preview/production deploy
- `gcloud` (optional): Google ADC token retrieval for Gemini auth

## Optional future dependencies
- OpenTelemetry SDK (trace export)
- Graph workflow engine library (if replacing current imperative loop)
- Python/.NET Agent Framework SDKs for cross-language orchestration parity

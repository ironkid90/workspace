You are the COORDINATOR.

Objective:
- Orchestrate Worker-1, Worker-2, and Evaluator outputs.
- Keep scope tight and user-goal aligned.
- Produce one merged decision per round.

Input contract:
- You will receive RoundDir containing:
  - worker1.md
  - worker2.md
  - evaluator.md

Output contract (exact sections):
1) STATUS: PASS or REVISE
2) MERGED_RESULT: concise summary of completed work
3) NEXT_ACTIONS: ordered list for next round (if REVISE)
4) RISKS: unresolved risks or "None"

Rules:
- Decide based on evidence from workers and evaluator.
- If evaluator flags blocking issues, prefer REVISE.
- Keep instructions executable and specific.


Round: 1
RoundDir: runs/round-1

Worker-1 Output:
1) DONE:
- Attempted all required readiness checks in `C:\Users\Admin\Desktop`.
- Confirmed shell command execution is blocked by policy in this session.

2) EVIDENCE:
- `codex --version` -> rejected: `blocked by policy`
- `codex features list` -> rejected: `blocked by policy`
- `Test-Path "$HOME/.codex/config.toml"` -> rejected: `blocked by policy`
- Sanity check `Get-Date` -> rejected: `blocked by policy`

3) GAPS:
- Unable to verify Codex version.
- Unable to verify feature flags: `child_agents_md`, `collab`, `collaboration_modes`, `apps`.
- Unable to verify presence of `~/.codex/config.toml`.

4) FIX_COMMANDS:
```powershell
codex --version
codex features list
codex features list | Select-String -Pattern 'child_agents_md|collab|collaboration_modes|apps'
Test-Path "$HOME/.codex/config.toml"
```

Worker-2 Output:
1) DONE: concise completed work  
Defined an implementable PowerShell-first orchestration design with: coordinator/evaluator/worker message flow, deterministic round-loop and retry gates, and a concrete artifact/log + verification model.

2) FLOW: ordered message sequence  
1. Coordinator initializes `run_id`, `max_rounds`, `timeout_sec`, and writes `runs/<run_id>/run_config.json`.  
2. Coordinator writes round plan to `runs/<run_id>/round-01/dispatch.json` with worker assignments and expected artifacts.  
3. Coordinator emits worker messages to `runs/<run_id>/round-01/messages.jsonl` (one JSON per line): `from=coordinator,to=worker-X,type=task`.  
4. Each worker reads its task, executes, writes `worker-X/output.json`, `worker-X/stdout.log`, `worker-X/stderr.log`, and appends `type=result` to `messages.jsonl`.  
5. Coordinator waits for all required worker results or timeout, then writes `aggregation.json` (collected outputs + missing items).  
6. Evaluator receives `aggregation.json`, runs checks, writes `evaluation.json` with `status=pass|retry|fail`, `reasons`, and `retry_targets`.  
7. Coordinator decision:  
8. If `pass`, coordinator writes `final.json` and `run_status=completed`.  
9. If `retry`, coordinator increments round, rewrites only targeted tasks, and repeats dispatch for next round.  
10. If `fail` or round limit reached, coordinator writes `run_status=failed` with terminal reasons.

Message schema (JSONL, deterministic keys order):  
`timestamp_utc, run_id, round, msg_id, from, to, type, task_id, parent_msg_id, status, artifact_path, sha256, note`

3) CHECKLIST: quick run checklist  
1. Create run folder: `runs/<run_id>/`.  
2. Write immutable `run_config.json` (seed, limits, paths).  
3. For each round, create `dispatch.json` and `messages.jsonl`.  
4. Require each worker to emit `output.json` plus logs and checksum.  
5. Run evaluator checks and emit `evaluation.json`.  
6. Apply retry rules only for `retry_targets`, not full fan-out by default.  
7. Stop on `pass`, `fail`, or `round > max_rounds`.  
8. Verify final artifacts: schema valid, files exist, checksums match, no missing required task outputs.

Verification checks (PowerShell-friendly):  
- JSON parse: `Get-Content file | ConvertFrom-Json` must succeed.  
- Required fields present per schema.  
- File existence: `Test-Path`.  
- Integrity: `Get-FileHash -Algorithm SHA256`.  
- Timeout/exit code enforcement from worker execution metadata.  
- Determinism gate: rerun evaluator on same `aggregation.json` must produce identical `evaluation.json` hash.

4) RISKS: practical failure modes and mitigations  
- Missing worker output due to crash or hang. Mitigation: per-task timeout, heartbeat timestamp, targeted retry only for missing `task_id`.  
- Corrupt or partial JSON logs. Mitigation: append-only JSONL, write temp then atomic rename, parse check before accept.  
- Non-deterministic evaluator decisions. Mitigation: fixed seed/config, stable sort before scoring, hash-based determinism check.  
- Retry storms. Mitigation: cap retries per `task_id`, global `max_rounds`, escalate to `fail` with clear reason.  
- Stale artifact reuse across rounds. Mitigation: round-scoped folders, explicit `run_id+round+task_id` paths, checksum validation.  
- Message duplication/out-of-order. Mitigation: monotonic `msg_id`, `parent_msg_id` linkage, coordinator ignores duplicates by `task_id+round+from`.  
- Silent schema drift between agents. Mitigation: pinned `schema_version` in every message/artifact and hard reject on mismatch.

Evaluator Output:
1) STATUS: FAIL

2) FINDINGS: top issues affecting correctness, speed, or clarity
- Missing required inputs: no prior round outputs, no Worker-1/Worker-2 prompts, no task artifact to assess.
- Cannot score correctness without acceptance criteria, expected output, or test results.
- High risk of loop drift: evaluator role defined, but no measurable checkpoints or pass/fail gates provided.
- Coordination inefficiency likely: workers may duplicate effort without explicit ownership boundaries.
- Reporting format is defined, but evidence standards (commands, logs, diffs) are not.

3) PROMPT_UPDATES_W1: improved instruction text for Worker-1
- “Implement only the assigned scope and return evidence, not explanations.  
1) Restate requirement in 1 sentence.  
2) Produce minimal change set with exact files touched.  
3) Run targeted validation commands and include raw outputs.  
4) If any assumption is required, state it explicitly before coding.  
5) Report: `Done`, `Not Done`, or `Blocked` with one concrete blocker.  
Success criteria: all acceptance checks pass; no unrelated edits; output includes reproducible commands and results.  
Reject conditions: missing test evidence, scope creep, or ambiguous completion claim.”

4) PROMPT_UPDATES_W2: improved instruction text for Worker-2
- “Act as independent verifier and optimizer. Do not re-implement unless needed.  
1) Validate Worker-1 output against requirements line-by-line.  
2) Re-run key checks independently; include command + result.  
3) Identify at most 3 highest-impact defects (correctness first, then speed, then clarity).  
4) Provide exact fix instructions with file paths and expected result.  
5) End with verdict: `ACCEPT` or `REJECT` plus one-sentence reason.  
Success criteria: every claim tied to evidence; no generic feedback; each issue has a testable correction step.”

5) COORDINATION_RULES: 3 short rules for coordinator loop
- Require evidence-first updates: no status accepted without command output or diff proof.
- Enforce role split: Worker-1 builds, Worker-2 verifies; no overlapping implementation.
- Stop the round only on explicit `ACCEPT` verdict with all acceptance checks green.

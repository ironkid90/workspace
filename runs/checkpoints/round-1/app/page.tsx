"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentState, RunMode, SwarmFeatures, SwarmRunState } from "@/lib/swarm/types";

interface StateResponse {
  state: SwarmRunState;
  capabilities: {
    supportsLocalExecution: boolean;
    supportsPauseResume: boolean;
    supportsRewind: boolean;
  };
}

const DEFAULT_FEATURES: SwarmFeatures = {
  lintLoop: true,
  ensembleVoting: true,
  researchAgent: true,
  contextCompression: true,
  heuristicSelector: true,
  checkpointing: true,
  humanInLoop: true,
};

function eventBadge(status: string): { text: string; cls: string } {
  if (status === "PASS") {
    return { text: "Pass", cls: "ok" };
  }
  if (status === "FAIL") {
    return { text: "Fail", cls: "err" };
  }
  if (status === "REVISE") {
    return { text: "Revise", cls: "warn" };
  }
  return { text: status || "Idle", cls: "info" };
}

function phaseClass(phase: AgentState["phase"]): string {
  return `pill ${phase}`;
}

function formatTime(iso?: string): string {
  if (!iso) {
    return "-";
  }
  return new Date(iso).toLocaleTimeString();
}

export default function HomePage() {
  const [state, setState] = useState<SwarmRunState | null>(null);
  const [mode, setMode] = useState<RunMode>("local");
  const [maxRounds, setMaxRounds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [supportsLocal, setSupportsLocal] = useState(true);
  const [supportsPauseResume, setSupportsPauseResume] = useState(true);
  const [supportsRewind, setSupportsRewind] = useState(true);
  const [features, setFeatures] = useState<SwarmFeatures>(DEFAULT_FEATURES);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    const res = await fetch("/api/swarm/state", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to load state: ${res.status}`);
    }
    const data = (await res.json()) as StateResponse;
    setState(data.state);
    setFeatures(data.state.features);
    setSupportsLocal(data.capabilities.supportsLocalExecution);
    setSupportsPauseResume(data.capabilities.supportsPauseResume);
    setSupportsRewind(data.capabilities.supportsRewind);
    if (!data.capabilities.supportsLocalExecution) {
      setMode("demo");
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    const source = new EventSource("/api/swarm/stream");
    const onState = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const nextState = JSON.parse(message.data) as SwarmRunState;
        setState(nextState);
        setError(null);
      } catch {
        // ignore malformed event
      }
    };

    source.addEventListener("state", onState);
    source.onerror = () => {
      setError("Stream interrupted. Reconnecting...");
    };

    return () => {
      source.removeEventListener("state", onState);
      source.close();
    };
  }, []);

  const startRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/swarm/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxRounds, mode, features }),
      });

      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "Unable to start run.");
      }
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [features, loadState, maxRounds, mode]);

  const controlRun = useCallback(async (action: "pause" | "resume" | "rewind", round?: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/swarm/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, round }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || `Failed control action: ${action}`);
      }
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [loadState]);

  const latestEvents = useMemo(() => {
    if (!state) {
      return [];
    }
    return [...state.events].reverse().slice(0, 140);
  }, [state]);

  const latestMessages = useMemo(() => {
    if (!state) {
      return [];
    }
    return [...state.messages].reverse().slice(0, 80);
  }, [state]);

  const runBadge = eventBadge(state?.rounds.at(-1)?.status ?? "IDLE");
  const isRunning = Boolean(state?.running);
  const latestCheckpointRound = state?.checkpoints.at(-1)?.round;

  const toggleFeature = useCallback((feature: keyof SwarmFeatures) => {
    if (isRunning) {
      return;
    }
    setFeatures((prev) => ({ ...prev, [feature]: !prev[feature] }));
  }, [isRunning]);

  return (
    <main className="shell">
      <div className="top">
        <div>
          <h1 className="title">Swarm Ops Board</h1>
          <p className="subtitle">
            Real-time coordinator/evaluator/worker orchestration with checkpointing, lint loop,
            ensemble voting, and structured agent message flow.
          </p>
        </div>

        <div className="controls">
          <label className="tiny mono">
            Max rounds
            <input
              type="number"
              min={1}
              max={8}
              value={maxRounds}
              onChange={(event) => setMaxRounds(Number(event.target.value) || 1)}
              disabled={isRunning}
            />
          </label>

          <label className="tiny mono">
            Mode
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as RunMode)}
              disabled={isRunning}
            >
              {supportsLocal && <option value="local">Local runner</option>}
              <option value="demo">Demo/replay</option>
            </select>
          </label>

          <button className="btn" onClick={() => void startRun()} disabled={busy || isRunning}>
            {isRunning ? "Run in progress" : "Start swarm"}
          </button>

          {supportsPauseResume && isRunning && !state?.paused && (
            <button className="btn alt" onClick={() => void controlRun("pause")} disabled={busy}>
              Pause
            </button>
          )}
          {supportsPauseResume && isRunning && state?.paused && (
            <button className="btn alt" onClick={() => void controlRun("resume")} disabled={busy}>
              Resume
            </button>
          )}
          {supportsRewind && state?.paused && latestCheckpointRound && (
            <button
              className="btn alt"
              onClick={() => void controlRun("rewind", latestCheckpointRound)}
              disabled={busy}
            >
              Rewind r{latestCheckpointRound}
            </button>
          )}
        </div>
      </div>

      <div className="meta">
        Run ID: {state?.runId ?? "-"} | Mode: {state?.mode ?? "-"} | Round: {state?.currentRound ?? 0} |
        Paused: {state?.paused ? "yes" : "no"}
      </div>

      <section className="card featurePanel">
        <div className="cardHead">
          <h2>Runtime Features</h2>
          <span className="badge info">{isRunning ? "locked" : "editable"}</span>
        </div>
        <div className="featureGrid tiny mono">
          {Object.entries(features).map(([name, value]) => (
            <label key={name} className="featureToggle">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={() => toggleFeature(name as keyof SwarmFeatures)}
                disabled={isRunning}
              />
              {name}
            </label>
          ))}
        </div>
      </section>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: "rgba(255,109,109,0.4)" }}>
          <strong>Error</strong>
          <p className="eventMsg">{error}</p>
        </div>
      )}

      <div className="grid main">
        <section className="card">
          <div className="cardHead">
            <h2>Live Agents</h2>
            <span className={`badge ${runBadge.cls}`}>{runBadge.text}</span>
          </div>
          <div className="agents">
            {state &&
              Object.values(state.agents).map((agent) => (
                <article key={agent.id} className="agent">
                  <div className="agentHead">
                    <span className="agentName">{agent.label}</span>
                    <span className={phaseClass(agent.phase)}>{agent.phase}</span>
                  </div>
                  <div className="tiny mono">
                    Round {agent.round} | PDA: {agent.pdaStage || "-"} | target: {agent.taskTarget || "-"}
                  </div>
                  <div className="tiny mono">
                    start {formatTime(agent.startedAt)} | end {formatTime(agent.endedAt)}
                  </div>
                  {agent.excerpt && <p className="excerpt">{agent.excerpt}</p>}
                  {agent.outputFile && (
                    <div className="tiny mono" style={{ marginTop: 6 }}>
                      {agent.outputFile}
                    </div>
                  )}
                </article>
              ))}
          </div>

          <div className="roundList">
            <h3>Round Decisions</h3>
            {state?.rounds.length ? (
              state.rounds.map((round) => {
                const badge = eventBadge(round.status);
                return (
                  <div key={round.round} className="roundRow">
                    <div className="cardHead">
                      <strong>Round {round.round}</strong>
                      <span className={`badge ${badge.cls}`}>{badge.text}</span>
                    </div>
                    <div className="tiny mono">
                      Worker-2: {round.worker2Decision || "-"} | Evaluator: {round.evaluatorStatus || "-"} |
                      Coordinator: {round.coordinatorStatus || "-"} | Lint:{" "}
                      {round.lintPassed === false ? "FAIL" : "PASS/SKIP"}
                    </div>
                    {round.changedFiles && round.changedFiles.length > 0 && (
                      <p className="tiny mono">Changed: {round.changedFiles.join(", ")}</p>
                    )}
                    {round.notes.length > 0 && (
                      <ul className="notes">
                        {round.notes.map((note, index) => (
                          <li key={`${round.round}-${index}`}>{note}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="tiny">No rounds completed yet.</p>
            )}
          </div>
        </section>

        <section className="card">
          <div className="cardHead">
            <h2>Activity Feed</h2>
            <span className="badge info">{latestEvents.length} events</span>
          </div>
          <div className="timeline">
            {latestEvents.length ? (
              latestEvents.map((event) => (
                <article
                  key={event.id}
                  className={`event ${event.level === "error" ? "error" : event.level === "warn" ? "warn" : ""}`}
                >
                  <div className="tiny mono">
                    {new Date(event.ts).toLocaleTimeString()} | r{event.round} | {event.type}
                    {event.agentId ? ` | ${event.agentId}` : ""}
                  </div>
                  <p className="eventMsg">{event.message}</p>
                </article>
              ))
            ) : (
              <p className="tiny">Waiting for run activity...</p>
            )}
          </div>
        </section>
      </div>

      <div className="grid secondary">
        <section className="card">
          <div className="cardHead">
            <h2>Agent Messages</h2>
            <span className="badge info">{latestMessages.length} records</span>
          </div>
          <div className="timeline">
            {latestMessages.length ? (
              latestMessages.map((item, index) => (
                <article key={`${item.timestampUtc}-${index}`} className="event">
                  <div className="tiny mono">
                    {new Date(item.timestampUtc).toLocaleTimeString()} | r{item.round} | {item.type}
                  </div>
                  <p className="eventMsg">
                    {item.from} -&gt; {item.to}: {item.summary}
                  </p>
                  {item.artifactPath && <div className="tiny mono">{item.artifactPath}</div>}
                </article>
              ))
            ) : (
              <p className="tiny">No structured messages yet.</p>
            )}
          </div>
        </section>

        <section className="card">
          <div className="cardHead">
            <h2>Checkpoints & Gates</h2>
            <span className="badge info">{state?.checkpoints.length ?? 0} checkpoints</span>
          </div>
          <div className="roundList">
            <h3>Checkpoints</h3>
            {state?.checkpoints.length ? (
              state.checkpoints.map((cp) => (
                <div key={cp.round} className="roundRow">
                  <div className="tiny mono">
                    Round {cp.round} | {cp.restorable ? "restorable" : "not restorable"}
                  </div>
                  <div className="tiny mono">{cp.dir}</div>
                </div>
              ))
            ) : (
              <p className="tiny">No checkpoints yet.</p>
            )}

            <h3>Lint Results</h3>
            {state?.lintResults.length ? (
              state.lintResults.map((lint) => (
                <div key={lint.round} className="roundRow">
                  <div className="tiny mono">
                    Round {lint.round} | {lint.command}
                  </div>
                  <div className="tiny mono">
                    {lint.ran ? `exit ${lint.exitCode}` : "not run"} | {lint.passed ? "pass" : "fail"}
                  </div>
                </div>
              ))
            ) : (
              <p className="tiny">No lint records yet.</p>
            )}

            <h3>Ensemble Outcomes</h3>
            {state?.ensembles.length ? (
              state.ensembles.map((result) => (
                <div key={result.round} className="roundRow">
                  <div className="tiny mono">
                    Round {result.round} | variant: {result.selectedVariant} | status: {result.selectedStatus}
                  </div>
                  <div className="tiny mono">{JSON.stringify(result.votes)}</div>
                </div>
              ))
            ) : (
              <p className="tiny">No ensemble records yet.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

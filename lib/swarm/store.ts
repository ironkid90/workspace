import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import {
  AGENT_IDS,
  DEFAULT_FEATURES,
  type AgentId,
  type AgentMessage,
  type CheckpointInfo,
  type EnsembleResult,
  type LintResult,
  type RoundSummary,
  type PendingApproval,
  type SwarmFeatures,
  type RunMode,
  type SwarmEvent,
  type SwarmRunState,
  createAgentDefaults,
} from "./types";

const MAX_EVENTS = 500;

type EventInput = Omit<SwarmEvent, "id" | "runId" | "ts">;

function createInitialState(): SwarmRunState {
  return {
    runId: null,
    mode: "local",
    workspace: "",
    maxRounds: 0,
    running: false,
    paused: false,
    pendingApproval: undefined,
    currentRound: 0,
    features: { ...DEFAULT_FEATURES },
    agents: createAgentDefaults(),
    rounds: [],
    checkpoints: [],
    messages: [],
    lintResults: [],
    ensembles: [],
    events: [],
    errors: [],
  };
}

function cloneState(state: SwarmRunState): SwarmRunState {
  return JSON.parse(JSON.stringify(state)) as SwarmRunState;
}

class SwarmStore {
  private readonly emitter = new EventEmitter();
  private state = createInitialState();
  private eventCounter = 0;

  getState(): SwarmRunState {
    return cloneState(this.state);
  }

  subscribe(listener: (event: SwarmEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  startRun(opts: {
    workspace: string;
    maxRounds: number;
    mode: RunMode;
    features?: Partial<SwarmFeatures>;
  }): string {
    if (this.state.running) {
      throw new Error("A swarm run is already in progress.");
    }

    const features: SwarmFeatures = { ...DEFAULT_FEATURES, ...opts.features };
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    this.state = {
      runId,
      mode: opts.mode,
      workspace: opts.workspace,
      maxRounds: opts.maxRounds,
      running: true,
      paused: false,
      pendingApproval: undefined,
      startedAt,
      currentRound: 0,
      features,
      agents: createAgentDefaults(),
      rounds: [],
      checkpoints: [],
      messages: [],
      lintResults: [],
      ensembles: [],
      events: [],
      errors: [],
    };

    this.appendEvent({
      type: "run.started",
      round: 0,
      message: `Swarm run ${runId.slice(0, 8)} started in ${opts.mode} mode.`,
      metadata: { workspace: opts.workspace, maxRounds: opts.maxRounds, features },
    });
    return runId;
  }

  finishRun(message = "Swarm run completed."): void {
    this.state.running = false;
    this.state.paused = false;
    this.state.pauseReason = undefined;
    this.state.pendingApproval = undefined;
    this.state.endedAt = new Date().toISOString();
    for (const agentId of AGENT_IDS) {
      if (this.state.agents[agentId].phase === "running") {
        this.state.agents[agentId].phase = "completed";
        this.state.agents[agentId].endedAt = new Date().toISOString();
      }
    }

    this.appendEvent({
      type: "run.finished",
      round: this.state.currentRound,
      message,
    });
  }

  failRun(error: unknown): void {
    this.state.running = false;
    this.state.paused = false;
    this.state.pauseReason = undefined;
    this.state.pendingApproval = undefined;
    this.state.endedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    this.state.errors.push(message);

    this.appendEvent({
      type: "run.failed",
      round: this.state.currentRound,
      message,
      level: "error",
    });
  }

  setPaused(paused: boolean, reason?: string): void {
    this.state.paused = paused;
    this.state.pauseReason = paused ? reason || "Paused by operator." : undefined;
    this.appendEvent({
      type: paused ? "run.paused" : "run.resumed",
      round: this.state.currentRound,
      message: paused ? this.state.pauseReason || "Run paused." : "Run resumed.",
      metadata: paused ? { reason: this.state.pauseReason } : undefined,
    });
  }

  setCurrentRound(round: number): void {
    this.state.currentRound = round;
  }

  setPendingApproval(pending?: PendingApproval): void {
    this.state.pendingApproval = pending;
  }

  setAgentState(
    agentId: AgentId,
    patch: Partial<SwarmRunState["agents"][AgentId]>,
  ): void {
    this.state.agents[agentId] = { ...this.state.agents[agentId], ...patch };
  }

  upsertRound(summary: RoundSummary): void {
    const existing = this.state.rounds.findIndex((item) => item.round === summary.round);
    if (existing >= 0) {
      this.state.rounds[existing] = summary;
      return;
    }
    this.state.rounds.push(summary);
  }

  upsertLintResult(result: LintResult): void {
    const existing = this.state.lintResults.findIndex((item) => item.round === result.round);
    if (existing >= 0) {
      this.state.lintResults[existing] = result;
      return;
    }
    this.state.lintResults.push(result);
  }

  upsertEnsembleResult(result: EnsembleResult): void {
    const existing = this.state.ensembles.findIndex((item) => item.round === result.round);
    if (existing >= 0) {
      this.state.ensembles[existing] = result;
      return;
    }
    this.state.ensembles.push(result);
  }

  upsertCheckpoint(checkpoint: CheckpointInfo): void {
    const existing = this.state.checkpoints.findIndex((item) => item.round === checkpoint.round);
    if (existing >= 0) {
      this.state.checkpoints[existing] = checkpoint;
      return;
    }
    this.state.checkpoints.push(checkpoint);
  }

  appendMessage(message: AgentMessage): void {
    this.state.messages.push(message);
    if (this.state.messages.length > MAX_EVENTS * 2) {
      this.state.messages = this.state.messages.slice(-MAX_EVENTS * 2);
    }
  }

  appendEvent(input: EventInput): SwarmEvent {
    if (!this.state.runId) {
      throw new Error("Cannot append event without an active run.");
    }

    const event: SwarmEvent = {
      id: ++this.eventCounter,
      runId: this.state.runId,
      ts: new Date().toISOString(),
      ...input,
    };
    this.state.events.push(event);
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events = this.state.events.slice(-MAX_EVENTS);
    }

    this.emitter.emit("event", event);
    return event;
  }
}

declare global {
  var __codexSwarmStore: SwarmStore | undefined;
}

export const swarmStore = global.__codexSwarmStore ?? new SwarmStore();
if (!global.__codexSwarmStore) {
  global.__codexSwarmStore = swarmStore;
}

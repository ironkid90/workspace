export type AgentId =
  | "research"
  | "worker1"
  | "worker2"
  | "evaluator"
  | "coordinator";

export type AgentPhase = "idle" | "queued" | "running" | "completed" | "failed";
export type PdaStage = "perceive" | "decide" | "act";

export type RunMode = "local" | "demo";

export type RoundStatus = "RUNNING" | "PASS" | "REVISE" | "FAIL";

export interface AgentState {
  id: AgentId;
  label: string;
  phase: AgentPhase;
  round: number;
  startedAt?: string;
  endedAt?: string;
  outputFile?: string;
  excerpt?: string;
  pdaStage?: PdaStage;
  taskTarget?: string;
}

export interface RoundSummary {
  round: number;
  status: RoundStatus;
  worker2Decision?: string;
  evaluatorStatus?: string;
  coordinatorStatus?: string;
  lintPassed?: boolean;
  auditorSkipped?: boolean;
  changedFiles?: string[];
  notes: string[];
}

export interface SwarmEvent {
  id: number;
  runId: string;
  ts: string;
  type: string;
  round: number;
  message: string;
  level?: "info" | "warn" | "error";
  agentId?: AgentId;
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  timestampUtc: string;
  round: number;
  from: AgentId | "system";
  to: AgentId | "broadcast";
  type: "task" | "result" | "feedback" | "error" | "control";
  summary: string;
  artifactPath?: string;
  sha256?: string;
}

export interface LintResult {
  round: number;
  command: string;
  ran: boolean;
  passed: boolean;
  exitCode: number;
  outputExcerpt?: string;
}

export interface EnsembleResult {
  round: number;
  selectedVariant: string;
  selectedStatus: RoundStatus;
  votes: Record<string, number>;
}

export interface CheckpointInfo {
  round: number;
  dir: string;
  createdAt: string;
  restorable: boolean;
}

export interface SwarmFeatures {
  lintLoop: boolean;
  ensembleVoting: boolean;
  researchAgent: boolean;
  contextCompression: boolean;
  heuristicSelector: boolean;
  checkpointing: boolean;
  humanInLoop: boolean;
}

export interface SwarmRunState {
  runId: string | null;
  mode: RunMode;
  workspace: string;
  maxRounds: number;
  running: boolean;
  paused: boolean;
  pauseReason?: string;
  startedAt?: string;
  endedAt?: string;
  currentRound: number;
  features: SwarmFeatures;
  agents: Record<AgentId, AgentState>;
  rounds: RoundSummary[];
  checkpoints: CheckpointInfo[];
  messages: AgentMessage[];
  lintResults: LintResult[];
  ensembles: EnsembleResult[];
  events: SwarmEvent[];
  errors: string[];
}

export const AGENT_IDS: AgentId[] = [
  "research",
  "worker1",
  "worker2",
  "evaluator",
  "coordinator",
];

export const DEFAULT_FEATURES: SwarmFeatures = {
  lintLoop: true,
  ensembleVoting: true,
  researchAgent: true,
  contextCompression: true,
  heuristicSelector: true,
  checkpointing: true,
  humanInLoop: true,
};

export function createAgentDefaults(): Record<AgentId, AgentState> {
  return {
    research: {
      id: "research",
      label: "Research",
      phase: "idle",
      round: 0,
    },
    worker1: {
      id: "worker1",
      label: "Worker-1",
      phase: "idle",
      round: 0,
    },
    worker2: {
      id: "worker2",
      label: "Worker-2",
      phase: "idle",
      round: 0,
    },
    evaluator: {
      id: "evaluator",
      label: "Evaluator",
      phase: "idle",
      round: 0,
    },
    coordinator: {
      id: "coordinator",
      label: "Coordinator",
      phase: "idle",
      round: 0,
    },
  };
}

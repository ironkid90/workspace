
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  appendFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  compressForContext,
  parseCoordinatorStatus,
  parseDefectSeverities,
  parseEvaluatorStatus,
  parseRisks,
  parseWorker2Decision,
  summarizeOutput,
} from "./parse";
import { swarmStore } from "./store";
import type {
  AgentId,
  AgentMessage,
  CheckpointInfo,
  LintResult,
  RoundStatus,
  RunMode,
  SwarmFeatures,
} from "./types";
import { verifyOutputSafety } from "./verifier";

const PROJECT_ROOT = process.cwd();
const PROMPTS_DIR = path.join(PROJECT_ROOT, "prompts");
const RUNS_DIR = path.join(PROJECT_ROOT, "runs");
const CHECKPOINTS_DIR = path.join(RUNS_DIR, "checkpoints");
const MESSAGE_FILE = "messages.jsonl";
const MAX_ALLOWED_ROUNDS = 8;

const CHECKPOINT_TARGETS = [
  "app",
  "lib",
  "prompts",
  "run-swarm.ps1",
  "README.md",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "AGENTS_ARCHITECTURE.md",
  "AGENTS_KNOWLEDGE.md",
  "AGENTS_ROADMAP.md",
  "DEPENDENCIES.md",
];

let activeRunPromise: Promise<void> | null = null;

interface StartOptions {
  maxRounds?: number;
  workspace?: string;
  mode?: RunMode;
  features?: Partial<SwarmFeatures>;
}

interface StartResult {
  runId: string;
  mode: RunMode;
  features: SwarmFeatures;
}

interface AgentTask {
  agentId: AgentId;
  round: number;
  prompt: string;
  outFile: string;
  workspace: string;
  mode: RunMode;
  roundDir: string;
  target: AgentId | "broadcast";
  logPrefix?: string;
}

interface AgentTaskResult {
  text: string;
  outFile: string;
  sha256: string;
  failed: boolean;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface CheckpointManifest {
  round: number;
  createdAt: string;
  entries: Array<{ path: string; kind: "file" | "dir"; existed: boolean }>;
}

interface GeminiResearchConfig {
  providerEnabled: boolean;
  model: string;
  apiKey?: string;
  oauthToken?: string;
  useAdc: boolean;
  baseUrl: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRel(value: string): string {
  return value.split(path.sep).join("/");
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function clampRounds(value?: number): number {
  const parsed = Number.isFinite(value) ? Math.floor(value as number) : 3;
  return Math.max(1, Math.min(MAX_ALLOWED_ROUNDS, parsed || 3));
}

function resolveRunMode(input?: RunMode): RunMode {
  if (input) {
    return input;
  }
  if (process.env.SWARM_FORCE_DEMO === "1" || process.env.VERCEL) {
    return "demo";
  }
  return "local";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPrompt(name: string): Promise<string> {
  return readFile(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
}

function emitAgentLog(
  agentId: AgentId,
  round: number,
  text: string,
  level: "info" | "warn" | "error" = "info",
  prefix?: string,
): void {
  const msg = text.trim();
  if (!msg) {
    return;
  }
  swarmStore.appendEvent({
    type: "agent.log",
    agentId,
    round,
    level,
    message: prefix ? `[${prefix}] ${msg.slice(-320)}` : msg.slice(-360),
  });
}

async function runProcess(
  command: string,
  args: string[],
  opts: { cwd: string; shell?: boolean; onStdout?: (text: string) => void; onStderr?: (text: string) => void },
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: process.env,
      windowsHide: true,
      shell: Boolean(opts.shell),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      opts.onStdout?.(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      opts.onStderr?.(text);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      }),
    );
  });
}

async function appendMessage(roundDir: string, message: AgentMessage): Promise<void> {
  swarmStore.appendMessage(message);
  await appendFile(path.join(roundDir, MESSAGE_FILE), `${JSON.stringify(message)}\n`, "utf8");
}

function message(input: Omit<AgentMessage, "timestampUtc">): AgentMessage {
  return { timestampUtc: nowIso(), ...input };
}

function setPda(agentId: AgentId, round: number, stage: "perceive" | "decide" | "act"): void {
  swarmStore.setAgentState(agentId, { pdaStage: stage });
  swarmStore.appendEvent({
    type: "agent.pda",
    round,
    agentId,
    message: `${agentId} -> ${stage}`,
    metadata: { stage },
  });
}

function getGeminiConfig(): GeminiResearchConfig {
  const providerEnabled = (process.env.SWARM_RESEARCH_PROVIDER || "").toLowerCase() === "gemini";
  const model = process.env.GEMINI_MODEL || "gemini-3-pro";
  const apiKey = process.env.GEMINI_API_KEY || undefined;
  const oauthToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || undefined;
  const useAdc = process.env.GOOGLE_USE_ADC === "1";
  const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  return {
    providerEnabled,
    model,
    apiKey,
    oauthToken,
    useAdc,
    baseUrl,
  };
}

async function getGoogleAccessTokenFromAdc(workspace: string): Promise<string | null> {
  try {
    const result = await runProcess("gcloud", ["auth", "application-default", "print-access-token"], {
      cwd: workspace,
    });
    if (result.exitCode !== 0) {
      return null;
    }
    const token = result.stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const root = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  const parts = root.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function runGeminiResearch(
  workspace: string,
  round: number,
  seed: string,
  localSignals: string[],
): Promise<string | null> {
  const cfg = getGeminiConfig();
  if (!cfg.providerEnabled) {
    return null;
  }

  const prompt = [
    "You are a research assistant inside a coding swarm orchestration runtime.",
    "Summarize key implementation and risk guidance from these local signals.",
    "Return concise bullet points with concrete next actions.",
    "",
    `Round: ${round}`,
    `Seed: ${seed || "(none)"}`,
    "Signals:",
    ...localSignals.slice(0, 20).map((line) => `- ${line}`),
  ].join("\n");

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 700,
    },
  };

  let token: string | undefined = cfg.oauthToken;
  if (!cfg.apiKey && !token && cfg.useAdc) {
    token = (await getGoogleAccessTokenFromAdc(workspace)) || undefined;
  }
  if (!cfg.apiKey && !token) {
    return null;
  }

  const endpoint = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const url = cfg.apiKey ? `${endpoint}?key=${encodeURIComponent(cfg.apiKey)}` : endpoint;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  return extractGeminiText(json) || null;
}
async function waitIfPaused(round: number, gate: string): Promise<void> {
  for (;;) {
    const state = swarmStore.getState();
    if (!state.running) {
      throw new Error("Run no longer active.");
    }
    if (!state.paused) {
      return;
    }
    swarmStore.appendEvent({
      type: "run.pause_gate",
      round,
      message: `Paused at ${gate}; waiting for resume.`,
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}



async function waitForApprovalGate(round: number, agentId: AgentId, gate: string, enabled: boolean): Promise<void> {
  if (!enabled) {
    return;
  }

  const requestedAt = nowIso();
  swarmStore.setPendingApproval({ round, agentId, gate, requestedAt });
  swarmStore.appendEvent({
    type: "run.approval_requested",
    round,
    agentId,
    message: `Approval required before ${agentId} action (${gate}).`,
    metadata: { gate, requestedAt },
  });

  for (;;) {
    const state = swarmStore.getState();
    if (!state.running) {
      swarmStore.setPendingApproval(undefined);
      throw new Error("Run no longer active.");
    }
    const pending = state.pendingApproval;
    const waitingForCurrentGate =
      pending && pending.round === round && pending.agentId === agentId && pending.gate === gate;
    if (!waitingForCurrentGate) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}
async function runCodexTask(task: AgentTask): Promise<void> {
  const codexBin = process.env.SWARM_CODEX_BIN || "codex";
  const args = [
    "--dangerously-bypass-approvals-and-sandbox",
    "exec",
    "--cd",
    task.workspace,
    "--skip-git-repo-check",
    "--json",
    task.prompt,
    "-o",
    task.outFile,
  ];
  const result = await runProcess(codexBin, args, {
    cwd: task.workspace,
    onStdout: (text) => emitAgentLog(task.agentId, task.round, text, "info", task.logPrefix),
    onStderr: (text) => emitAgentLog(task.agentId, task.round, text, "warn", task.logPrefix),
  });
  if (result.exitCode !== 0) {
    throw new Error(`Codex exited ${result.exitCode}: ${result.stderr.slice(-400)}`);
  }
}

function demoOutput(agentId: AgentId, round: number): string {
  if (agentId === "research") {
    return "1) SEARCH_SCOPE:\n- local docs\n\n2) SIGNALS:\n- enforce lint/checkpoint loops\n\n3) ACTIONABLE_CONTEXT:\n- include changed files and rewind path";
  }
  if (agentId === "worker1") {
    return `1) PLAN:\n- Implement round ${round}\n\n2) CHANGES:\n- lib/swarm/engine.ts: updates\n\n3) VALIDATION:\n- npm run build (0)\n\n4) RESULTS:\n- pass\n\n5) RISKS:\n- demo`;
  }
  if (agentId === "worker2") {
    const decision = round >= 2 ? "APPROVE" : "REJECT";
    return `1) COVERAGE TABLE:\n- checked\n\n2) DEFECTS:\n- ${decision === "APPROVE" ? "none" : "[MED] sample defect"}\n\n3) PERFORMANCE CHECK:\n- none\n\n4) DECISION: ${decision}`;
  }
  if (agentId === "evaluator") {
    const status = round >= 2 ? "PASS" : "FAIL";
    return `1) STATUS: ${status}\n\n2) FINDINGS:\n- sample\n\n3) PROMPT_UPDATES_W1:\n- sample\n\n4) PROMPT_UPDATES_W2:\n- sample\n\n5) COORDINATION_RULES:\n- sample`;
  }
  return `1) STATUS: ${round >= 2 ? "PASS" : "REVISE"}\n\n2) MERGED_RESULT: sample\n\n3) NEXT_ACTIONS:\n1. sample\n\n4) RISKS:\n- None`;
}

async function runDemoTask(task: AgentTask): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 500)));
  await writeFile(task.outFile, demoOutput(task.agentId, task.round), "utf8");
}

async function runAgentTask(task: AgentTask): Promise<AgentTaskResult> {
  swarmStore.setAgentState(task.agentId, {
    phase: "running",
    round: task.round,
    startedAt: nowIso(),
    endedAt: undefined,
    outputFile: normalizeRel(path.relative(PROJECT_ROOT, task.outFile)),
    excerpt: undefined,
    taskTarget: task.target,
  });
  swarmStore.appendEvent({
    type: "agent.started",
    round: task.round,
    agentId: task.agentId,
    message: `${task.agentId} started.`,
  });
  await appendMessage(
    task.roundDir,
    message({
      round: task.round,
      from: "system",
      to: task.agentId,
      type: "task",
      summary: `Execute ${task.agentId} in round ${task.round}.`,
    }),
  );

  setPda(task.agentId, task.round, "perceive");
  setPda(task.agentId, task.round, "decide");
  setPda(task.agentId, task.round, "act");

  try {
    await waitIfPaused(task.round, `${task.agentId}-act`);
    await waitForApprovalGate(
      task.round,
      task.agentId,
      `${task.agentId}-act`,
      swarmStore.getState().features.approveNextActionGate,
    );
    if (task.mode === "demo") {
      await runDemoTask(task);
    } else {
      await runCodexTask(task);
    }

    const text = await readFile(task.outFile, "utf8");
    const digest = hashText(text);
    const excerpt = summarizeOutput(text);

    swarmStore.setAgentState(task.agentId, {
      phase: "completed",
      endedAt: nowIso(),
      excerpt,
      pdaStage: "act",
    });
    swarmStore.appendEvent({
      type: "agent.finished",
      round: task.round,
      agentId: task.agentId,
      message: `${task.agentId} finished.`,
      metadata: { sha256: digest },
    });

    for (const issue of verifyOutputSafety(text)) {
      swarmStore.appendEvent({
        type: "agent.safety",
        round: task.round,
        agentId: task.agentId,
        level: "warn",
        message: issue,
      });
    }

    await appendMessage(
      task.roundDir,
      message({
        round: task.round,
        from: task.agentId,
        to: task.target,
        type: "result",
        summary: excerpt || `${task.agentId} completed`,
        artifactPath: normalizeRel(path.relative(PROJECT_ROOT, task.outFile)),
        sha256: digest,
      }),
    );
    return { text, outFile: task.outFile, sha256: digest, failed: false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await writeFile(task.outFile, `ERROR: ${msg}`, "utf8");
    const digest = hashText(`ERROR: ${msg}`);
    swarmStore.setAgentState(task.agentId, {
      phase: "failed",
      endedAt: nowIso(),
      excerpt: msg.slice(0, 260),
      pdaStage: "act",
    });
    swarmStore.appendEvent({
      type: "agent.failed",
      round: task.round,
      agentId: task.agentId,
      level: "error",
      message: msg,
    });
    await appendMessage(
      task.roundDir,
      message({
        round: task.round,
        from: task.agentId,
        to: task.target,
        type: "error",
        summary: msg.slice(0, 220),
        artifactPath: normalizeRel(path.relative(PROJECT_ROOT, task.outFile)),
        sha256: digest,
      }),
    );
    return { text: `ERROR: ${msg}`, outFile: task.outFile, sha256: digest, failed: true };
  }
}
async function runResearch(
  round: number,
  workspace: string,
  mode: RunMode,
  roundDir: string,
  seed: string,
): Promise<AgentTaskResult> {
  const outFile = path.join(roundDir, "research.md");
  swarmStore.setAgentState("research", {
    phase: "running",
    round,
    startedAt: nowIso(),
    endedAt: undefined,
    outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
    excerpt: undefined,
    taskTarget: "broadcast",
  });
  swarmStore.appendEvent({
    type: "agent.started",
    round,
    agentId: "research",
    message: "research started.",
  });
  await appendMessage(
    roundDir,
    message({
      round,
      from: "system",
      to: "research",
      type: "task",
      summary: "Collect local architectural and implementation context.",
    }),
  );
  setPda("research", round, "perceive");
  setPda("research", round, "decide");
  setPda("research", round, "act");

  await waitIfPaused(round, "research-act");
  await waitForApprovalGate(
    round,
    "research",
    "research-act",
    swarmStore.getState().features.approveNextActionGate,
  );

  if (mode === "demo") {
    await writeFile(outFile, demoOutput("research", round), "utf8");
    const txt = await readFile(outFile, "utf8");
    const digest = hashText(txt);
    swarmStore.setAgentState("research", {
      phase: "completed",
      round,
      endedAt: nowIso(),
      outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
      excerpt: summarizeOutput(txt),
      pdaStage: "act",
      taskTarget: "broadcast",
    });
    swarmStore.appendEvent({
      type: "agent.finished",
      round,
      agentId: "research",
      message: "research finished.",
      metadata: { sha256: digest },
    });
    await appendMessage(
      roundDir,
      message({
        round,
        from: "research",
        to: "broadcast",
        type: "feedback",
        summary: summarizeOutput(txt),
        artifactPath: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
        sha256: digest,
      }),
    );
    return { text: txt, outFile, sha256: digest, failed: false };
  }

  const terms = (seed.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).slice(0, 6);
  const pattern =
    terms.length > 0
      ? terms.join("|")
      : "coordinator|evaluator|worker|lint|checkpoint|rewind|selector|context";
  let lines: string[] = [];
  try {
    const result = await runProcess(
      "rg",
      [
        "-n",
        "--max-count",
        "60",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!.next/**",
        "--glob",
        "!runs/**",
        pattern,
        "AGENTS_ARCHITECTURE.md",
        "AGENTS_KNOWLEDGE.md",
        "AGENTS_ROADMAP.md",
        "DEPENDENCIES.md",
        "lib",
        "app",
        "prompts",
      ],
      { cwd: workspace },
    );
    lines = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 25);
  } catch {
    lines = ["Research fallback: `rg` was not available in this environment."];
  }
  let geminiInsight: string | null = null;
  try {
    geminiInsight = await runGeminiResearch(workspace, round, seed, lines);
    if (geminiInsight) {
      swarmStore.appendEvent({
        type: "research.provider",
        round,
        agentId: "research",
        message: "Gemini research provider produced supplemental insights.",
        metadata: { provider: "gemini", model: process.env.GEMINI_MODEL || "gemini-3-pro" },
      });
    }
  } catch (error) {
    swarmStore.appendEvent({
      type: "research.provider",
      round,
      agentId: "research",
      level: "warn",
      message: error instanceof Error ? error.message : String(error),
      metadata: { provider: "gemini" },
    });
  }

  const textLines = [
    "1) SEARCH_SCOPE:",
    "- local docs + runtime",
    "",
    "2) KEY_TERMS:",
    terms.length ? `- ${terms.join(", ")}` : "- default terms",
    "",
    "3) MATCHED_EVIDENCE:",
    ...(lines.length ? lines.map((line) => `- ${line}`) : ["- no matches"]),
  ];
  if (geminiInsight) {
    textLines.push("", "4) GEMINI_INSIGHTS:");
    for (const line of geminiInsight.split(/\r?\n/).slice(0, 20)) {
      const trimmed = line.trim();
      if (trimmed) {
        textLines.push(`- ${trimmed.replace(/^-+\s*/, "")}`);
      }
    }
  }
  const text = textLines.join("\n");
  await writeFile(outFile, text, "utf8");
  const digest = hashText(text);
  swarmStore.setAgentState("research", {
    phase: "completed",
    round,
    endedAt: nowIso(),
    outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
    excerpt: summarizeOutput(text),
    pdaStage: "act",
    taskTarget: "broadcast",
  });
  swarmStore.appendEvent({
    type: "agent.finished",
    round,
    agentId: "research",
    message: "research finished.",
    metadata: { sha256: digest },
  });
  await appendMessage(
    roundDir,
    message({
      round,
      from: "research",
      to: "broadcast",
      type: "feedback",
      summary: summarizeOutput(text),
      artifactPath: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
      sha256: digest,
    }),
  );
  return { text, outFile, sha256: digest, failed: false };
}

async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function collectFromDir(rootAbs: string, relRoot: string, map: Map<string, string>): Promise<void> {
  const entries = await readdir(rootAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "runs") {
      continue;
    }
    const abs = path.join(rootAbs, entry.name);
    const rel = normalizeRel(path.join(relRoot, entry.name));
    if (entry.isDirectory()) {
      await collectFromDir(abs, rel, map);
      continue;
    }
    if (entry.isFile()) {
      map.set(rel, await hashFile(abs));
    }
  }
}

async function collectFingerprints(workspace: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const target of CHECKPOINT_TARGETS) {
    const abs = path.join(workspace, target);
    if (!(await pathExists(abs))) {
      continue;
    }
    const st = await stat(abs);
    if (st.isDirectory()) {
      await collectFromDir(abs, target, map);
    } else if (st.isFile()) {
      map.set(normalizeRel(target), await hashFile(abs));
    }
  }
  return map;
}

function diffFingerprints(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [file, hash] of before.entries()) {
    if (!after.has(file) || after.get(file) !== hash) {
      changed.add(file);
    }
  }
  for (const file of after.keys()) {
    if (!before.has(file)) {
      changed.add(file);
    }
  }
  return [...changed].sort();
}

async function createCheckpoint(round: number, workspace: string): Promise<CheckpointInfo> {
  await mkdir(CHECKPOINTS_DIR, { recursive: true });
  const dir = path.join(CHECKPOINTS_DIR, `round-${round}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const manifest: CheckpointManifest = { round, createdAt: nowIso(), entries: [] };
  for (const rel of CHECKPOINT_TARGETS) {
    const source = path.join(workspace, rel);
    if (!(await pathExists(source))) {
      manifest.entries.push({ path: normalizeRel(rel), kind: "file", existed: false });
      continue;
    }
    const st = await stat(source);
    manifest.entries.push({
      path: normalizeRel(rel),
      kind: st.isDirectory() ? "dir" : "file",
      existed: true,
    });
    const dest = path.join(dir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(source, dest, { recursive: true, force: true, errorOnExist: false });
  }
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const info: CheckpointInfo = {
    round,
    dir: normalizeRel(path.relative(PROJECT_ROOT, dir)),
    createdAt: manifest.createdAt,
    restorable: true,
  };
  swarmStore.upsertCheckpoint(info);
  return info;
}

async function restoreCheckpoint(round: number, workspace: string): Promise<number> {
  const dir = path.join(CHECKPOINTS_DIR, `round-${round}`);
  const manifestPath = path.join(dir, "manifest.json");
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Checkpoint round ${round} not found.`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CheckpointManifest;
  let touched = 0;
  for (const entry of manifest.entries) {
    const dst = path.join(workspace, entry.path);
    if (entry.existed) {
      const src = path.join(dir, entry.path);
      if (await pathExists(dst)) {
        await rm(dst, { recursive: true, force: true });
      }
      await mkdir(path.dirname(dst), { recursive: true });
      await cp(src, dst, { recursive: true, force: true, errorOnExist: false });
      touched += 1;
    } else if (await pathExists(dst)) {
      await rm(dst, { recursive: true, force: true });
      touched += 1;
    }
  }
  return touched;
}
async function resolveLintCommand(workspace: string): Promise<string | null> {
  const packageFile = path.join(workspace, "package.json");
  if (!(await pathExists(packageFile))) {
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(packageFile, "utf8")) as { scripts?: Record<string, string> };
    if (parsed.scripts?.lint) {
      return "npm run lint";
    }
  } catch {
    return null;
  }
  return null;
}

async function runLint(round: number, workspace: string, roundDir: string, changedFiles: string[]): Promise<LintResult> {
  if (changedFiles.length === 0) {
    return { round, command: "skipped (no changes)", ran: false, passed: true, exitCode: 0 };
  }
  const command = await resolveLintCommand(workspace);
  if (!command) {
    return { round, command: "skipped (no lint script)", ran: false, passed: true, exitCode: 0 };
  }
  const result = await runProcess(command, [], { cwd: workspace, shell: true });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  await writeFile(path.join(roundDir, "lint.log"), output, "utf8");
  return {
    round,
    command,
    ran: true,
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    outputExcerpt: summarizeOutput(output, 5),
  };
}

function maybeCompress(text: string, enabled: boolean): string {
  return enabled ? compressForContext(text) : text;
}

async function runCoordinatorEnsemble(
  round: number,
  workspace: string,
  mode: RunMode,
  roundDir: string,
  prompt: string,
): Promise<AgentTaskResult> {
  const outFile = path.join(roundDir, "coordinator.md");
  swarmStore.setAgentState("coordinator", {
    phase: "running",
    round,
    startedAt: nowIso(),
    outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
    taskTarget: "broadcast",
  });
  const variants = [
    { id: "strict", suffix: "\n\nEnsemble mode: prioritize strict correctness." },
    { id: "balanced", suffix: "\n\nEnsemble mode: balance correctness and velocity." },
    { id: "risk", suffix: "\n\nEnsemble mode: maximize risk discovery." },
  ];
  const results = await Promise.all(
    variants.map(async (variant) => {
      const variantOut = path.join(roundDir, `coordinator-${variant.id}.md`);
      if (mode === "demo") {
        await writeFile(variantOut, demoOutput("coordinator", round), "utf8");
      } else {
        await runCodexTask({
          agentId: "coordinator",
          round,
          prompt: `${prompt}${variant.suffix}`,
          outFile: variantOut,
          workspace,
          mode,
          roundDir,
          target: "broadcast",
          logPrefix: `coordinator:${variant.id}`,
        });
      }
      const text = await readFile(variantOut, "utf8");
      for (const issue of verifyOutputSafety(text)) {
        swarmStore.appendEvent({
          type: "agent.safety",
          round,
          agentId: "coordinator",
          level: "warn",
          message: `[${variant.id}] ${issue}`,
        });
      }
      return {
        id: variant.id,
        text,
        status: parseCoordinatorStatus(text),
        outFile: variantOut,
        sha256: hashText(text),
      };
    }),
  );

  const votes: Record<string, number> = {};
  for (const item of results) {
    votes[item.status] = (votes[item.status] || 0) + 1;
  }
  const selectedStatus = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    "REVISE") as RoundStatus;
  const selected = results.find((item) => item.status === selectedStatus) || results[0];
  await writeFile(outFile, selected.text, "utf8");

  swarmStore.upsertEnsembleResult({
    round,
    selectedVariant: selected.id,
    selectedStatus,
    votes,
  });
  swarmStore.setAgentState("coordinator", {
    phase: "completed",
    endedAt: nowIso(),
    excerpt: summarizeOutput(selected.text),
    pdaStage: "act",
  });
  await appendMessage(
    roundDir,
    message({
      round,
      from: "coordinator",
      to: "broadcast",
      type: "result",
      summary: `Ensemble selected ${selected.id} (${selectedStatus}).`,
      artifactPath: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
      sha256: selected.sha256,
    }),
  );
  return {
    text: selected.text,
    outFile,
    sha256: selected.sha256,
    failed: selected.text.startsWith("ERROR:"),
  };
}

function deriveRoundStatus(
  coordinatorStatus: RoundStatus,
  worker2Decision: string | undefined,
  evaluatorStatus: string | undefined,
  lintPassed: boolean,
): RoundStatus {
  if (coordinatorStatus === "FAIL") {
    return "FAIL";
  }
  if (!lintPassed) {
    return "REVISE";
  }
  const auditorOk = worker2Decision === "APPROVE" || worker2Decision === "SKIPPED_NO_CHANGES";
  if (coordinatorStatus === "PASS" && evaluatorStatus === "PASS" && auditorOk) {
    return "PASS";
  }
  return "REVISE";
}
async function runSwarm(opts: { maxRounds: number; workspace: string; mode: RunMode }): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  let prevFeedback = "";

  for (let round = 1; round <= opts.maxRounds; round += 1) {
    const features = swarmStore.getState().features;
    await waitIfPaused(round, "round_start");
    swarmStore.setCurrentRound(round);
    swarmStore.appendEvent({ type: "round.started", round, message: `Round ${round} started.` });

    const roundDir = path.join(RUNS_DIR, `round-${round}`);
    await mkdir(roundDir, { recursive: true });
    await writeFile(path.join(roundDir, MESSAGE_FILE), "", "utf8");

    if (features.checkpointing) {
      await createCheckpoint(round, opts.workspace);
      swarmStore.appendEvent({ type: "checkpoint.created", round, message: `Checkpoint round ${round} created.` });
    }

    const [baseW1, baseW2, baseEval, baseCoord] = await Promise.all([
      readPrompt("worker1"),
      readPrompt("worker2"),
      readPrompt("evaluator"),
      readPrompt("coordinator"),
    ]);

    const researchResult = features.researchAgent
      ? await runResearch(round, opts.workspace, opts.mode, roundDir, prevFeedback)
      : null;
    const feedbackSuffix = prevFeedback
      ? `\n\n--- PREVIOUS EVALUATOR FEEDBACK ---\n${maybeCompress(prevFeedback, features.contextCompression)}`
      : "";
    const researchSuffix =
      researchResult?.text
        ? `\n\n--- RESEARCH CONTEXT ---\n${maybeCompress(researchResult.text, features.contextCompression)}`
        : "";

    const before = features.heuristicSelector || features.lintLoop ? await collectFingerprints(opts.workspace) : new Map();

    const worker1 = await runAgentTask({
      agentId: "worker1",
      round,
      prompt: `${baseW1}${feedbackSuffix}${researchSuffix}`,
      outFile: path.join(roundDir, "worker1.md"),
      workspace: opts.workspace,
      mode: opts.mode,
      roundDir,
      target: "coordinator",
    });

    const after = features.heuristicSelector || features.lintLoop ? await collectFingerprints(opts.workspace) : new Map();
    const changedFiles = diffFingerprints(before, after);
    swarmStore.appendEvent({
      type: "workspace.diff",
      round,
      message: `Worker-1 changed ${changedFiles.length} tracked files.`,
      metadata: { changedFiles: changedFiles.slice(0, 20) },
    });

    const lint = features.lintLoop
      ? await runLint(round, opts.workspace, roundDir, changedFiles)
      : { round, command: "disabled", ran: false, passed: true, exitCode: 0 };
    swarmStore.upsertLintResult(lint);
    swarmStore.appendEvent({
      type: "lint.finished",
      round,
      level: lint.passed ? "info" : "warn",
      message: lint.ran
        ? lint.passed
          ? "Lint loop passed."
          : `Lint loop failed (exit ${lint.exitCode}).`
        : lint.command,
    });

    const evaluatorPromise = runAgentTask({
      agentId: "evaluator",
      round,
      prompt: `${baseEval}${feedbackSuffix}${researchSuffix}\n\n--- WORKER-1 OUTPUT ---\n${maybeCompress(worker1.text, features.contextCompression)}`,
      outFile: path.join(roundDir, "evaluator.md"),
      workspace: opts.workspace,
      mode: opts.mode,
      roundDir,
      target: "coordinator",
    });

    let worker2Skipped = false;
    const worker2Promise =
      features.heuristicSelector && changedFiles.length === 0
        ? (async () => {
            worker2Skipped = true;
            const outFile = path.join(roundDir, "worker2.md");
            const text =
              "1) COVERAGE TABLE:\n- no tracked file changes\n\n2) DEFECTS:\n- none\n\n3) PERFORMANCE CHECK:\n- skipped\n\n4) DECISION: SKIPPED_NO_CHANGES";
            await writeFile(outFile, text, "utf8");
            swarmStore.setAgentState("worker2", {
              phase: "completed",
              round,
              startedAt: nowIso(),
              endedAt: nowIso(),
              outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
              excerpt: "Auditor skipped by selector.",
              pdaStage: "act",
              taskTarget: "coordinator",
            });
            return { text, outFile, sha256: hashText(text), failed: false } as AgentTaskResult;
          })()
        : runAgentTask({
            agentId: "worker2",
            round,
            prompt: `${baseW2}${feedbackSuffix}${researchSuffix}\n\n--- TRACKED CHANGED FILES ---\n${
              changedFiles.length ? changedFiles.join("\n") : "(none)"
            }\n\n--- WORKER-1 OUTPUT ---\n${maybeCompress(worker1.text, features.contextCompression)}`,
            outFile: path.join(roundDir, "worker2.md"),
            workspace: opts.workspace,
            mode: opts.mode,
            roundDir,
            target: "coordinator",
          });

    const [worker2, evaluator] = await Promise.all([worker2Promise, evaluatorPromise]);
    prevFeedback = evaluator.text;

    const coordinatorPrompt = `${baseCoord}

Round: ${round}
Workspace: ${opts.workspace}
Lint: ran=${lint.ran}; passed=${lint.passed}; command=${lint.command}; exit=${lint.exitCode}
Changed files (${changedFiles.length}):
${changedFiles.length ? changedFiles.join("\n") : "(none)"}

Research:
${researchResult ? maybeCompress(researchResult.text, features.contextCompression) : "(disabled)"}

Worker-1 Output:
${maybeCompress(worker1.text, features.contextCompression)}

Worker-2 Output:
${maybeCompress(worker2.text, features.contextCompression)}

Evaluator Output:
${maybeCompress(evaluator.text, features.contextCompression)}
`;

    const coordinator = features.ensembleVoting
      ? await runCoordinatorEnsemble(round, opts.workspace, opts.mode, roundDir, coordinatorPrompt)
      : await runAgentTask({
          agentId: "coordinator",
          round,
          prompt: coordinatorPrompt,
          outFile: path.join(roundDir, "coordinator.md"),
          workspace: opts.workspace,
          mode: opts.mode,
          roundDir,
          target: "broadcast",
        });

    const coordStatus = parseCoordinatorStatus(coordinator.text);
    const worker2Decision = parseWorker2Decision(worker2.text) || (worker2Skipped ? "SKIPPED_NO_CHANGES" : undefined);
    const evalStatus = parseEvaluatorStatus(evaluator.text);
    const finalStatus = deriveRoundStatus(coordStatus, worker2Decision, evalStatus, lint.passed);

    const notes: string[] = [];
    if (worker2Decision) {
      notes.push(`Worker-2 decision: ${worker2Decision}`);
    }
    if (evalStatus) {
      notes.push(`Evaluator status: ${evalStatus}`);
    }
    notes.push(`Lint: ${lint.passed ? "PASS" : `FAIL (${lint.exitCode})`}`);
    notes.push(
      changedFiles.length === 0
        ? "Heuristic selector: no tracked file changes."
        : `Tracked changed files: ${changedFiles.slice(0, 6).join(", ")}`,
    );
    notes.push(...parseRisks(coordinator.text));

    swarmStore.upsertRound({
      round,
      status: finalStatus,
      worker2Decision,
      evaluatorStatus: evalStatus,
      coordinatorStatus: coordStatus,
      lintPassed: lint.passed,
      auditorSkipped: worker2Skipped,
      changedFiles: changedFiles.slice(0, 20),
      notes,
    });

    swarmStore.appendEvent({
      type: "round.finished",
      round,
      message: `Round ${round} finished with ${finalStatus}.`,
      metadata: { worker2Decision, evalStatus, coordStatus, lintPassed: lint.passed },
    });

    const defects = parseDefectSeverities(worker2.text);
    const shouldRewind =
      features.checkpointing &&
      round > 1 &&
      (coordStatus === "FAIL" || (!lint.passed && (defects.high > 0 || defects.med > 0)));
    if (shouldRewind) {
      const targetRound = round - 1;
      const restored = await restoreCheckpoint(targetRound, opts.workspace);
      swarmStore.appendEvent({
        type: "run.rewind",
        round,
        level: "warn",
        message: `Auto-rewind to checkpoint round ${targetRound}.`,
        metadata: { targetRound, restoredCount: restored },
      });
      if (features.humanInLoop) {
        swarmStore.setPaused(true, `Auto-paused after rewind to round ${targetRound}.`);
        await waitIfPaused(round, "post_rewind_review");
      }
    }

    if (finalStatus === "PASS") {
      swarmStore.finishRun("Coordinator, evaluator, and auditor reached PASS.");
      return;
    }
  }

  swarmStore.finishRun("Reached max rounds; revisions still required.");
}

export function getActiveRunPromise(): Promise<void> | null {
  return activeRunPromise;
}

export function pauseSwarmRun(reason?: string): boolean {
  const state = swarmStore.getState();
  if (!state.running || state.paused || !state.features.humanInLoop) {
    return false;
  }
  swarmStore.setPaused(true, reason || "Paused by operator.");
  return true;
}

export function resumeSwarmRun(): boolean {
  const state = swarmStore.getState();
  if (!state.running || !state.paused) {
    return false;
  }
  swarmStore.setPaused(false);
  return true;
}

export function approveSwarmPendingAction(): boolean {
  const state = swarmStore.getState();
  if (!state.running || !state.pendingApproval) {
    return false;
  }
  swarmStore.appendEvent({
    type: "run.approval_granted",
    round: state.pendingApproval.round,
    agentId: state.pendingApproval.agentId,
    message: `Approval granted for ${state.pendingApproval.agentId} (${state.pendingApproval.gate}).`,
    metadata: { gate: state.pendingApproval.gate },
  });
  swarmStore.setPendingApproval(undefined);
  return true;
}

export async function rewindSwarmToRound(round: number): Promise<{ round: number; restoredCount: number }> {
  const state = swarmStore.getState();
  if (!state.workspace) {
    throw new Error("No workspace available for rewind.");
  }
  if (state.running && !state.paused) {
    throw new Error("Pause the run before rewinding.");
  }
  const restoredCount = await restoreCheckpoint(round, state.workspace);
  swarmStore.appendEvent({
    type: "run.rewind",
    round: state.currentRound,
    level: "warn",
    message: `Manual rewind to round ${round}.`,
    metadata: { targetRound: round, restoredCount },
  });
  return { round, restoredCount };
}

export function startSwarmRun(options: StartOptions = {}): StartResult {
  const maxRounds = clampRounds(options.maxRounds);
  const workspace = path.resolve(options.workspace || PROJECT_ROOT);
  const mode = resolveRunMode(options.mode);
  const runId = swarmStore.startRun({
    workspace,
    maxRounds,
    mode,
    features: options.features,
  });
  const features = swarmStore.getState().features;

  activeRunPromise = runSwarm({ maxRounds, workspace, mode })
    .catch((error) => swarmStore.failRun(error))
    .finally(() => {
      activeRunPromise = null;
    });

  return { runId, mode, features };
}

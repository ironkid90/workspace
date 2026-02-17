#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import {
  getActiveRunPromise,
  pauseSwarmRun,
  resumeSwarmRun,
  rewindSwarmToRound,
  startSwarmRun,
} from "../lib/swarm/engine";
import { swarmStore } from "../lib/swarm/store";
import type { RunMode, SwarmFeatures } from "../lib/swarm/types";

interface ParsedArgs {
  command: string;
  flags: Map<string, string | boolean>;
  positionals: string[];
}

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const trimmed = arg.slice(2);
    if (trimmed.startsWith("no-")) {
      flags.set(trimmed.slice(3), false);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq > -1) {
      flags.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
      continue;
    }
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(trimmed, next);
      i += 1;
      continue;
    }
    flags.set(trimmed, true);
  }

  return { command, flags, positionals };
}

function flagString(flags: Map<string, string | boolean>, key: string, fallback = ""): string {
  const value = flags.get(key);
  if (typeof value === "string") {
    return value;
  }
  if (value === true) {
    return "true";
  }
  return fallback;
}

function flagBoolean(flags: Map<string, string | boolean>, key: string, fallback = false): boolean {
  const value = flags.get(key);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() !== "false";
  }
  return fallback;
}

function flagNumber(flags: Map<string, string | boolean>, key: string, fallback: number): number {
  const raw = flagString(flags, key, String(fallback));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

async function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; inherit?: boolean } = {},
): Promise<CmdResult> {
  const cwd = opts.cwd || ROOT;
  if (opts.inherit) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ code: code ?? 1, stdout: "", stderr: "" });
      });
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseEnv(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    map.set(key, value.replace(/^"(.*)"$/, "$1"));
  }
  return map;
}

function serializeEnv(map: Map<string, string>): string {
  const keys = [...map.keys()].sort();
  return `${keys.map((key) => `${key}=${map.get(key) ?? ""}`).join("\n")}\n`;
}

async function updateEnv(entries: Record<string, string | undefined>): Promise<void> {
  const existing = (await fileExists(ENV_PATH))
    ? parseEnv(await readFile(ENV_PATH, "utf8"))
    : new Map<string, string>();

  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === "") {
      existing.delete(key);
    } else {
      existing.set(key, value);
    }
  }

  await writeFile(ENV_PATH, serializeEnv(existing), "utf8");
}

function createPrompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (query: string) =>
    new Promise<string>((resolve) => {
      rl.question(query, (answer) => resolve(answer.trim()));
    });

  const close = () => rl.close();
  return { ask, close };
}

async function askYesNo(ask: (q: string) => Promise<string>, question: string, defaultYes = true) {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const answer = (await ask(`${question}${suffix}`)).toLowerCase();
  if (!answer) {
    return defaultYes;
  }
  return answer === "y" || answer === "yes";
}

function printUsage(): void {
  console.log("Swarm CLI");
  console.log("");
  console.log("Commands:");
  console.log("  setup                       Configure auth and API access (.env.local)");
  console.log("  run [--max-rounds N]        Run swarm in terminal (interactive controls)");
  console.log("      [--mode local|demo] [--workspace PATH]");
  console.log("      [--no-lintLoop --no-ensembleVoting --no-researchAgent --no-contextCompression]");
  console.log("      [--no-heuristicSelector --no-checkpointing --no-humanInLoop]");
  console.log("      [--non-interactive]");
  console.log("  deploy [--path PATH]        One-click Vercel preview deploy");
  console.log("      [--prod]");
}

async function ensureVercelAuth(ask?: (q: string) => Promise<string>): Promise<boolean> {
  const whoami = await runCommand("npx", ["vercel", "whoami"]);
  if (whoami.code === 0) {
    console.log(`Vercel logged in as: ${whoami.stdout.trim()}`);
    return true;
  }

  if (!ask) {
    return false;
  }

  const doLogin = await askYesNo(ask, "Vercel is not authenticated. Run `npx vercel login` now?");
  if (!doLogin) {
    return false;
  }

  const login = await runCommand("npx", ["vercel", "login"], { inherit: true });
  return login.code === 0;
}

async function setupCommand(): Promise<void> {
  const { ask, close } = createPrompter();
  try {
    console.log("Configuring swarm auth and provider access...");
    const updates: Record<string, string | undefined> = {};

    const codexCheck = await runCommand("codex", ["--help"]);
    console.log(codexCheck.code === 0 ? "Codex CLI detected." : "Codex CLI not detected in PATH.");

    const setOpenAi = await askYesNo(ask, "Set or update OPENAI_API_KEY in .env.local?");
    if (setOpenAi) {
      const openAiKey = await ask("OPENAI_API_KEY: ");
      if (openAiKey) {
        updates.OPENAI_API_KEY = openAiKey;
      }
    }

    const vercelReady = await ensureVercelAuth(ask);
    if (!vercelReady) {
      console.log("Skipping Vercel login. Deploy command will prompt again if needed.");
    }

    const setGh = await askYesNo(ask, "Check GitHub CLI login for agent integrations?");
    if (setGh) {
      const ghStatus = await runCommand("gh", ["auth", "status"]);
      if (ghStatus.code !== 0) {
        const doGhLogin = await askYesNo(ask, "GitHub CLI is not authenticated. Run `gh auth login` now?");
        if (doGhLogin) {
          await runCommand("gh", ["auth", "login"], { inherit: true });
        }
      } else {
        console.log("GitHub CLI authentication is active.");
      }
    }

    const providerChoice = (await ask("Gemini provider mode? [none/api/google] (default: none): "))
      .toLowerCase()
      .trim();

    if (providerChoice === "api") {
      const key = await ask("GEMINI_API_KEY: ");
      const model = (await ask("Gemini model (default gemini-3-pro): ")) || "gemini-3-pro";
      if (key) {
        updates.SWARM_RESEARCH_PROVIDER = "gemini";
        updates.GEMINI_API_KEY = key;
        updates.GEMINI_MODEL = model;
        updates.GOOGLE_USE_ADC = undefined;
        updates.GOOGLE_OAUTH_ACCESS_TOKEN = undefined;
      }
    } else if (providerChoice === "google") {
      const model = (await ask("Gemini model (default gemini-3-pro): ")) || "gemini-3-pro";
      updates.SWARM_RESEARCH_PROVIDER = "gemini";
      updates.GEMINI_MODEL = model;
      updates.GOOGLE_USE_ADC = "1";
      updates.GEMINI_API_KEY = undefined;

      const checkToken = await runCommand("gcloud", ["auth", "application-default", "print-access-token"]);
      if (checkToken.code !== 0) {
        const doLogin = await askYesNo(
          ask,
          "Google ADC is not available. Run `gcloud auth application-default login` now?",
        );
        if (doLogin) {
          await runCommand("gcloud", ["auth", "application-default", "login"], { inherit: true });
        }
      } else {
        console.log("Google ADC access token is available.");
      }
    } else if (providerChoice === "none") {
      const clearGemini = await askYesNo(ask, "Disable Gemini provider settings in .env.local?", false);
      if (clearGemini) {
        updates.SWARM_RESEARCH_PROVIDER = undefined;
        updates.GEMINI_API_KEY = undefined;
        updates.GEMINI_MODEL = undefined;
        updates.GOOGLE_USE_ADC = undefined;
        updates.GOOGLE_OAUTH_ACCESS_TOKEN = undefined;
      }
    }

    await updateEnv(updates);
    console.log(`Saved provider settings to ${ENV_PATH}`);
  } finally {
    close();
  }
}

function makeFeatures(flags: Map<string, string | boolean>): SwarmFeatures {
  return {
    lintLoop: flagBoolean(flags, "lintLoop", true),
    ensembleVoting: flagBoolean(flags, "ensembleVoting", true),
    researchAgent: flagBoolean(flags, "researchAgent", true),
    contextCompression: flagBoolean(flags, "contextCompression", true),
    heuristicSelector: flagBoolean(flags, "heuristicSelector", true),
    checkpointing: flagBoolean(flags, "checkpointing", true),
    humanInLoop: flagBoolean(flags, "humanInLoop", true),
  };
}

function printStateSummary(): void {
  const state = swarmStore.getState();
  const latest = state.rounds.at(-1);
  console.log(
    `state: running=${state.running} paused=${state.paused} round=${state.currentRound} status=${latest?.status ?? "IDLE"}`,
  );
}

async function runCommandInteractive(flags: Map<string, string | boolean>): Promise<void> {
  const mode = (flagString(flags, "mode", "local") as RunMode) || "local";
  const maxRounds = flagNumber(flags, "max-rounds", 3);
  const workspace = flagString(flags, "workspace", ROOT);
  const nonInteractive = flagBoolean(flags, "non-interactive", false);
  const features = makeFeatures(flags);

  const started = startSwarmRun({
    mode,
    maxRounds,
    workspace,
    features,
  });
  console.log(`Started run ${started.runId} in ${started.mode} mode.`);
  console.log("Features:", started.features);

  const unsubscribe = swarmStore.subscribe((event) => {
    const ts = new Date(event.ts).toLocaleTimeString();
    const prefix = event.agentId ? `${event.agentId}` : "system";
    console.log(`[${ts}] [r${event.round}] [${prefix}] ${event.type}: ${event.message}`);
  });

  let rl: readline.Interface | null = null;
  if (!nonInteractive && process.stdin.isTTY) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "swarm> ",
    });
    console.log("Controls: pause | resume | rewind <round> | status | help");
    rl.prompt();
    rl.on("line", (line) => {
      const trimmed = line.trim();
      void (async () => {
        if (!trimmed) {
          return;
        }
        if (trimmed === "pause") {
          const ok = pauseSwarmRun("Paused from CLI.");
          console.log(ok ? "Run paused." : "Pause not applied.");
          return;
        }
        if (trimmed === "resume") {
          const ok = resumeSwarmRun();
          console.log(ok ? "Run resumed." : "Resume not applied.");
          return;
        }
        if (trimmed.startsWith("rewind ")) {
          const round = Number(trimmed.split(/\s+/)[1]);
          if (!Number.isFinite(round)) {
            console.log("Usage: rewind <round>");
            return;
          }
          try {
            const result = await rewindSwarmToRound(Math.max(1, Math.floor(round)));
            console.log(`Rewound to round ${result.round}; restored ${result.restoredCount} paths.`);
          } catch (error) {
            console.log(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        if (trimmed === "status") {
          printStateSummary();
          return;
        }
        if (trimmed === "help") {
          console.log("pause | resume | rewind <round> | status");
          return;
        }
        console.log("Unknown command. Type `help`.");
      })()
        .catch((error) => console.log(error instanceof Error ? error.message : String(error)))
        .finally(() => rl?.prompt());
    });
  }

  await getActiveRunPromise();
  unsubscribe();
  rl?.close();
  printStateSummary();
}

async function deployCommand(flags: Map<string, string | boolean>): Promise<void> {
  const pathArg = flagString(flags, "path", ROOT);
  const deployPath = path.resolve(pathArg);
  const isProd = flagBoolean(flags, "prod", false);
  const prompt = createPrompter();
  const vercelReady = await ensureVercelAuth(prompt.ask);
  prompt.close();
  if (!vercelReady) {
    throw new Error("Vercel authentication is required for deploy.");
  }

  const args = ["vercel", "deploy", deployPath, "-y"];
  if (isProd) {
    args.push("--prod");
  }

  console.log(`Deploying ${deployPath} (${isProd ? "production" : "preview"})...`);
  const result = await runCommand("npx", args);
  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) {
    throw new Error(combined.trim() || "Vercel deploy failed.");
  }

  const urls = combined.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/g) ?? [];
  const url = urls.at(-1);
  if (url) {
    console.log(`Deployment URL: ${url}`);
  } else {
    console.log("Deployment completed. No URL could be parsed from output.");
    console.log(combined.trim());
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (command === "setup") {
    await setupCommand();
    return;
  }
  if (command === "run") {
    await runCommandInteractive(flags);
    return;
  }
  if (command === "deploy") {
    await deployCommand(flags);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

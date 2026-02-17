import type { RoundStatus } from "./types";

function capture(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

export function parseCoordinatorStatus(text: string): RoundStatus {
  const status = capture(text, /STATUS:\s*(PASS|REVISE|FAIL)/i)?.toUpperCase();
  if (status === "PASS" || status === "REVISE" || status === "FAIL") {
    return status;
  }
  return "RUNNING";
}

export function parseWorker2Decision(text: string): string | undefined {
  return capture(text, /DECISION:\s*(APPROVE|REJECT)/i)?.toUpperCase();
}

export function parseEvaluatorStatus(text: string): string | undefined {
  return capture(text, /STATUS:\s*(PASS|FAIL)/i)?.toUpperCase();
}

export function summarizeOutput(text: string, maxLines = 3): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("```"))
    .slice(0, maxLines);

  return lines.join(" | ").slice(0, 360);
}

export function parseRisks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const risks: string[] = [];
  let inRisks = false;

  for (const line of lines) {
    if (/^\s*\d+\)\s*RISKS/i.test(line) || /^\s*RISKS:/i.test(line)) {
      inRisks = true;
      continue;
    }
    if (inRisks && /^\s*\d+\)/.test(line)) {
      break;
    }
    if (!inRisks) {
      continue;
    }
    const cleaned = line.replace(/^\s*[-*]\s*/, "").trim();
    if (cleaned) {
      risks.push(cleaned);
    }
  }

  return risks.slice(0, 3);
}

export function compressForContext(text: string, edgeLines = 40): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= edgeLines * 2 + 10) {
    return text;
  }

  const head = lines.slice(0, edgeLines).join("\n");
  const tail = lines.slice(-edgeLines).join("\n");
  const omitted = lines.length - edgeLines * 2;
  return `${head}\n\n...[${omitted} lines omitted for context compression]...\n\n${tail}`;
}

export function parseDefectSeverities(text: string): { high: number; med: number; low: number } {
  const high = (text.match(/\[HIGH\]/g) ?? []).length;
  const med = (text.match(/\[MED\]/g) ?? []).length;
  const low = (text.match(/\[LOW\]/g) ?? []).length;
  return { high, med, low };
}

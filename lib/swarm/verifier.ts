const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (RSA|OPENSSH|PRIVATE) KEY-----/g,
  /(?:xoxb|xoxp|xoxs)-[A-Za-z0-9-]{10,48}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /\b(password|passwd|token|secret)\b\s*[:=]/gi,
];

export function verifyOutputSafety(text: string): string[] {
  const issues: string[] = [];

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`Potential secret exposure matched pattern: ${pattern.source}`);
    }
  }

  const backtickCount = (text.match(/```/g) ?? []).length;
  if (backtickCount % 2 !== 0) {
    issues.push("Malformed markdown fences detected (odd number of ``` tokens).");
  }

  if (/^\s*{[\s\S]*}\s*$/m.test(text) && !hasBalancedBraces(text)) {
    issues.push("Potential malformed JSON-like block detected (brace imbalance).");
  }

  return issues;
}

function hasBalancedBraces(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

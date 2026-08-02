/**
 * ARC — secret scanner (M6.5).
 *
 * Pure detection over text: no filesystem access, no network, no side effects,
 * so it runs identically in unit tests, in CI and in the startup validator.
 * Findings never carry the matched value — only a masked fingerprint.
 */
export const SECRET_SEVERITIES = ["high", "medium"] as const;
export type SecretSeverity = (typeof SECRET_SEVERITIES)[number];

export interface SecretRule {
  readonly id: string;
  readonly description: string;
  readonly severity: SecretSeverity;
  readonly pattern: RegExp;
}

export interface SecretFinding {
  readonly ruleId: string;
  readonly description: string;
  readonly severity: SecretSeverity;
  readonly path: string;
  readonly line: number;
  /** Masked preview — never the raw secret. */
  readonly masked: string;
}

/** Append-only catalog. Patterns are deliberately narrow to avoid false alarms. */
export const SECRET_RULES: readonly SecretRule[] = [
  {
    id: "private-key-block",
    description: "PEM private key block",
    severity: "high",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: "evm-private-key",
    description: "EVM private key (32-byte hex)",
    severity: "high",
    pattern: /\b0x[a-fA-F0-9]{64}\b/g,
  },
  {
    id: "supabase-service-role",
    description: "Supabase service-role key literal",
    severity: "high",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{10,}/g,
  },
  {
    id: "jwt-literal",
    description: "JWT literal (possible service key or session token)",
    severity: "high",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: "aws-access-key",
    description: "AWS access key id",
    severity: "high",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "openai-key",
    description: "OpenAI-style API key",
    severity: "high",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "github-token",
    description: "GitHub token",
    severity: "high",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "assigned-secret-literal",
    description: "Secret-shaped identifier assigned a long string literal",
    severity: "medium",
    pattern:
      /\b(?:api[_-]?key|secret[_-]?key|private[_-]?key|service[_-]?role[_-]?key|jwt[_-]?secret|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*["'`][^"'`\s]{16,}["'`]/gi,
  },
];

/** Lines carrying this marker are exempt (documented, reviewed exceptions). */
export const ALLOW_MARKER = "arc-secret-scan:allow";

function mask(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "*".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}…${"*".repeat(6)}…${trimmed.slice(-2)} (${trimmed.length} chars)`;
}

/** Scans one text blob. `path` is used for reporting only. */
export function scanText(path: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const rule of SECRET_RULES) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        findings.push({
          ruleId: rule.id,
          description: rule.description,
          severity: rule.severity,
          path,
          line: index + 1,
          masked: mask(match[0]),
        });
        if (match[0].length === 0) break;
      }
    }
  });

  return findings;
}

export interface SecretScanResult {
  readonly clean: boolean;
  readonly findings: readonly SecretFinding[];
  readonly filesScanned: number;
}

/** Scans a set of already-read files. */
export function scanFiles(files: readonly { path: string; content: string }[]): SecretScanResult {
  const findings = files.flatMap((file) => scanText(file.path, file.content));
  return { clean: findings.length === 0, findings, filesScanned: files.length };
}

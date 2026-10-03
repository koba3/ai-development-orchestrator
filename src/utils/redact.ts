const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
  /secret_[a-zA-Z0-9]{10,}/g,
  /ghp_[a-zA-Z0-9]{10,}/g,
  /github_pat_[a-zA-Z0-9_]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, () => {
      redacted = true;
      return "[REDACTED]";
    });
  }
  return { text: result, redacted };
}

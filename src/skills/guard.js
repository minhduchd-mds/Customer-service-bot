const RULES = [
  { category: 'destructive-command', reason: 'destructive filesystem command', re: /\brm\s+-[^\n]*r[^\n]*f\s+(?:\/|~|\$HOME)\b/i },
  { category: 'destructive-command', reason: 'disk or filesystem destruction command', re: /\b(?:mkfs(?:\.[a-z0-9]+)?|format\s+[a-z]:|diskpart\s+clean)\b/i },
  { category: 'remote-execution', reason: 'download piped directly into a shell', re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba)?sh\b/i },
  { category: 'remote-execution', reason: 'PowerShell download-and-execute pattern', re: /\b(?:invoke-webrequest|iwr|wget)\b[^\n]*(?:invoke-expression|\biex\b)/i },
  { category: 'credential-access', reason: 'private credential file access', re: /(?:\.ssh[\\/]id_(?:rsa|ed25519)|\/etc\/shadow|\.aws[\\/]credentials)/i },
  { category: 'credential-exfiltration', reason: 'secret-like environment value sent over the network', re: /\b(?:curl|wget|fetch)\b[^\n]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)/i },
  { category: 'path-traversal', reason: 'deep path traversal', re: /(?:\.\.[\\/]){3,}/ },
  { category: 'database-destruction', reason: 'destructive database statement', re: /\b(?:drop\s+(?:database|table)|truncate\s+table)\b/i },
  { category: 'privilege-escalation', reason: 'privilege escalation instruction', re: /\b(?:sudo\s+-?s|sudo\s+su|runas\s+\/user:administrator)\b/i },
  { category: 'secret-disclosure', reason: 'instruction attempts to expose hidden prompts or secrets', re: /(?:reveal|print|dump|expose).{0,40}(?:system prompt|hidden prompt|api key|access token|private key)/i }
];

export function scanSkillContent(content = '') {
  const violations = [];
  const lines = String(content).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue;
      violations.push({ category: rule.category, reason: rule.reason, line: index + 1 });
      break;
    }
  }
  return { safe: violations.length === 0, violations };
}

export function assertSafeSkillContent(content) {
  const result = scanSkillContent(content);
  if (!result.safe) {
    const error = new Error('skill_content_rejected');
    error.code = 'skill_content_rejected';
    error.violations = result.violations;
    throw error;
  }
  return result;
}

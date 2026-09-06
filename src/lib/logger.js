const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const log = (name, fields = {}) => {
    if ((LEVELS[name] ?? 100) < threshold) return;
    const safe = { ...fields };
    for (const key of Object.keys(safe)) {
      if (/token|secret|authorization|cookie/i.test(key)) safe[key] = '[redacted]';
    }
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: name, ...safe })}\n`);
  };
  return {
    debug: (fields) => log('debug', fields),
    info: (fields) => log('info', fields),
    warn: (fields) => log('warn', fields),
    error: (fields) => log('error', fields)
  };
}

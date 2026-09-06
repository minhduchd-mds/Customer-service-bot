import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.java', '.kt', '.kts',
  '.rs', '.php', '.rb', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.html', '.css', '.scss', '.yml', '.yaml', '.toml',
  '.sql', '.sh', '.env.example'
]);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'vendor', 'Pods']);

function tokens(query) {
  return [...new Set(String(query).toLocaleLowerCase('vi').split(/[^\p{L}\p{N}_-]+/u).filter((x) => x.length > 1))];
}

function scoreText(content, terms) {
  const lower = content.toLocaleLowerCase('vi');
  let score = 0;
  for (const term of terms) {
    let index = 0;
    while ((index = lower.indexOf(term, index)) !== -1) {
      score += 1;
      index += term.length;
      if (score > 100) break;
    }
  }
  return score;
}

function excerpt(content, terms, max = 700) {
  const lower = content.toLocaleLowerCase('vi');
  const indexes = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const center = indexes.length ? Math.min(...indexes) : 0;
  const start = Math.max(0, center - Math.floor(max / 3));
  const value = content.slice(start, start + max).replace(/\s+/g, ' ').trim();
  return start > 0 ? `…${value}` : value;
}

export class KnowledgeIndex {
  constructor({ root, maxFiles = 2500, maxFileBytes = 262144, logger } = {}) {
    this.root = path.resolve(root || './data/repos');
    this.maxFiles = maxFiles;
    this.maxFileBytes = maxFileBytes;
    this.logger = logger;
    this.files = null;
  }

  async build() {
    const found = [];
    const walk = async (dir) => {
      if (found.length >= this.maxFiles) return;
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (found.length >= this.maxFiles) break;
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await walk(full);
          continue;
        }
        const ext = path.extname(entry.name) || entry.name;
        if (!ALLOWED_EXTENSIONS.has(ext)) continue;
        try {
          const info = await stat(full);
          if (info.size <= this.maxFileBytes) found.push(full);
        } catch {}
      }
    };
    await walk(this.root);
    this.files = found;
    this.logger?.info({ event: 'knowledge_index_built', files: found.length });
    return found.length;
  }

  async search(query, { limit = 5 } = {}) {
    const terms = tokens(query);
    if (!terms.length) return [];
    if (!this.files) await this.build();
    const results = [];
    for (const file of this.files) {
      try {
        const content = await readFile(file, 'utf8');
        const score = scoreText(content, terms);
        if (!score) continue;
        results.push({
          path: path.relative(this.root, file),
          score,
          excerpt: excerpt(content, terms)
        });
      } catch {}
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

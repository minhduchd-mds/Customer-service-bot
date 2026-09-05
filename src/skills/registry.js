import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CORE_SKILLS } from './catalog.js';
import { assertSafeSkillContent } from './guard.js';

const MAX_CONTENT_CHARS = 32_000;
const VALID_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqueStrings(value, limit = 24, maxChars = 80) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim().slice(0, maxChars)).filter(Boolean))].slice(0, limit);
}

function slugify(value = '') {
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function tokenize(value = '') {
  return String(value).toLocaleLowerCase('vi').match(/[\p{L}\p{N}]+/gu) || [];
}

function hashSkill(skill) {
  const stable = JSON.stringify({
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    intents: skill.intents,
    triggers: skill.triggers,
    tags: skill.tags,
    capabilities: skill.capabilities,
    instructions: skill.instructions
  });
  return createHash('sha256').update(stable).digest('hex');
}

function parseScalar(value = '') {
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

export function parseSkillDocument(content = '') {
  const raw = String(content).slice(0, MAX_CONTENT_CHARS);
  const frontmatter = {};
  let body = raw.trim();
  if (raw.startsWith('---\n') || raw.startsWith('---\r\n')) {
    const normalized = raw.replace(/\r\n/g, '\n');
    const end = normalized.indexOf('\n---\n', 4);
    if (end >= 0) {
      const header = normalized.slice(4, end);
      body = normalized.slice(end + 5).trim();
      for (const line of header.split('\n')) {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!match) continue;
        frontmatter[match[1]] = parseScalar(match[2]);
      }
    }
  }
  return { frontmatter, body };
}

function normalizeCustomSkill(input = {}, existing = null) {
  const document = input.content != null ? parseSkillDocument(input.content) : { frontmatter: {}, body: '' };
  const meta = { ...document.frontmatter, ...input };
  delete meta.content;
  const name = String(meta.name || existing?.name || '').trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('skill_name_required'), { code: 'skill_name_required' });
  const slug = slugify(meta.slug || existing?.slug || name);
  if (!VALID_SLUG.test(slug)) throw Object.assign(new Error('invalid_skill_slug'), { code: 'invalid_skill_slug' });
  if (CORE_SKILLS.some((skill) => skill.slug === slug)) throw Object.assign(new Error('builtin_skill_conflict'), { code: 'builtin_skill_conflict' });

  const description = String(meta.description || existing?.description || '').trim().slice(0, 1024);
  const intents = uniqueStrings(Array.isArray(meta.intents) ? meta.intents : existing?.intents, 20, 40);
  const triggers = uniqueStrings(Array.isArray(meta.triggers) ? meta.triggers : existing?.triggers, 30, 120);
  const tags = uniqueStrings(Array.isArray(meta.tags) ? meta.tags : existing?.tags, 20, 40);
  const capabilities = uniqueStrings(Array.isArray(meta.capabilities) ? meta.capabilities : existing?.capabilities, 30, 80);
  const instructions = String(meta.instructions || document.body || existing?.instructions || '').trim().slice(0, MAX_CONTENT_CHARS);
  if (!instructions) throw Object.assign(new Error('skill_instructions_required'), { code: 'skill_instructions_required' });

  assertSafeSkillContent([
    `name: ${name}`,
    `description: ${description}`,
    `triggers: ${triggers.join(' | ')}`,
    `tags: ${tags.join(' | ')}`,
    instructions
  ].join('\n'));

  const skill = {
    id: existing?.id || `skill_${randomUUID()}`,
    slug,
    name,
    description,
    intents,
    triggers,
    tags,
    capabilities,
    instructions,
    source: 'custom',
    version: existing?.version || 1,
    enabled: typeof meta.enabled === 'boolean' ? meta.enabled : existing?.enabled ?? true,
    status: 'active',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  skill.fileHash = hashSkill(skill);
  return skill;
}

function skillAllowedForBot(skill, bot) {
  if (!skill.enabled || skill.status !== 'active') return false;
  const settings = bot?.skills;
  if (!settings || settings.mode !== 'allowlist') return true;
  return Array.isArray(settings.grants) && settings.grants.includes(skill.slug);
}

function publicSkill(skill, includeContent = false) {
  if (!skill) return null;
  const item = clone(skill);
  if (!includeContent) delete item.instructions;
  return item;
}

export class SkillRegistry {
  constructor({ file = './data/state/skills.json', logger } = {}) {
    this.file = path.resolve(file);
    this.logger = logger;
    this.loaded = false;
    this.custom = [];
    this.disabledBuiltins = new Set();
  }

  async list({ bot = null, includeDisabled = false, includeContent = false } = {}) {
    await this.load();
    const builtins = CORE_SKILLS.map((skill) => ({ ...skill, enabled: !this.disabledBuiltins.has(skill.slug), fileHash: hashSkill(skill) }));
    const all = [...builtins, ...this.custom];
    return all
      .filter((skill) => includeDisabled || skillAllowedForBot(skill, bot))
      .map((skill) => publicSkill(skill, includeContent));
  }

  async get(slug, { bot = null, includeDisabled = false, includeContent = true } = {}) {
    const skills = await this.list({ bot, includeDisabled, includeContent });
    return skills.find((skill) => skill.slug === slug) || null;
  }

  async publish(input = {}) {
    await this.load();
    const requestedSlug = slugify(input.slug || parseSkillDocument(input.content || '').frontmatter.name || input.name || '');
    const existing = requestedSlug ? this.custom.find((skill) => skill.slug === requestedSlug) : null;
    const next = normalizeCustomSkill(input, existing);
    const match = this.custom.find((skill) => skill.slug === next.slug);
    if (match && match.fileHash === next.fileHash) return { skill: publicSkill(match, true), unchanged: true };
    if (match) {
      next.id = match.id;
      next.createdAt = match.createdAt;
      next.version = match.version + 1;
      const index = this.custom.findIndex((skill) => skill.slug === match.slug);
      this.custom[index] = next;
    } else {
      this.custom.push(next);
    }
    await this.persist();
    return { skill: publicSkill(next, true), unchanged: false };
  }

  async toggle(slug, enabled) {
    await this.load();
    if (CORE_SKILLS.some((skill) => skill.slug === slug)) {
      enabled ? this.disabledBuiltins.delete(slug) : this.disabledBuiltins.add(slug);
      await this.persist();
      return this.get(slug, { includeDisabled: true });
    }
    const skill = this.custom.find((item) => item.slug === slug);
    if (!skill) return null;
    skill.enabled = Boolean(enabled);
    skill.updatedAt = new Date().toISOString();
    await this.persist();
    return publicSkill(skill, true);
  }

  async search(query, { bot = null, limit = 5 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const terms = tokenize(q);
    const skills = await this.list({ bot, includeContent: true });
    const docs = skills.map((skill) => {
      const weighted = [
        skill.name, skill.name,
        skill.description,
        ...(skill.tags || []),
        ...(skill.triggers || []), ...(skill.triggers || []),
        ...(skill.intents || [])
      ].join(' ');
      const tokens = tokenize(weighted);
      return { skill, tokens, length: Math.max(tokens.length, 1) };
    });
    const avgLength = docs.reduce((sum, item) => sum + item.length, 0) / Math.max(docs.length, 1);
    const scores = docs.map((doc) => {
      let score = 0;
      for (const term of terms) {
        const tf = doc.tokens.filter((token) => token === term).length;
        if (!tf) continue;
        const containing = docs.filter((item) => item.tokens.includes(term)).length;
        const idf = Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5));
        const denom = tf + 1.2 * (1 - 0.75 + 0.75 * (doc.length / Math.max(avgLength, 1)));
        score += idf * ((tf * 2.2) / denom);
      }
      for (const trigger of doc.skill.triggers || []) {
        if (trigger && q.toLocaleLowerCase('vi').includes(trigger.toLocaleLowerCase('vi'))) score += 3;
      }
      if (doc.skill.slug === q.toLowerCase()) score += 5;
      return { skill: publicSkill(doc.skill), score: Number(score.toFixed(4)) };
    });
    return scores.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)));
  }

  async select({ intent, text, bot = null } = {}) {
    const candidates = await this.list({ bot, includeContent: true });
    if (!candidates.length) return null;

    const exact = candidates.find((skill) => skill.intents?.includes(intent));
    if (exact) return { ...exact, matchScore: 100, matchReason: 'intent' };

    const searched = await this.search(text || intent || '', { bot, limit: 1 });
    if (searched[0]) {
      const full = candidates.find((skill) => skill.slug === searched[0].skill.slug) || null;
      if (full) return { ...full, matchScore: searched[0].score, matchReason: 'search' };
    }

    const fallback = candidates.find((skill) => skill.slug === 'knowledge-retrieval')
      || candidates.find((skill) => skill.intents?.includes('general'))
      || candidates[0];
    return { ...fallback, matchScore: 0, matchReason: 'allowed-fallback' };
  }

  async evaluate(cases = [], { bot = null } = {}) {
    const bounded = Array.isArray(cases) ? cases.slice(0, 100) : [];
    const results = [];
    for (const item of bounded) {
      const selected = await this.select({ intent: item.intent || '', text: item.text || '', bot });
      const expected = String(item.expectedSkill || item.expected || '');
      results.push({
        text: String(item.text || '').slice(0, 300),
        expectedSkill: expected,
        selectedSkill: selected?.slug || null,
        pass: expected ? selected?.slug === expected : null
      });
    }
    const scored = results.filter((item) => item.pass != null);
    return {
      total: results.length,
      scored: scored.length,
      passed: scored.filter((item) => item.pass).length,
      accuracy: scored.length ? scored.filter((item) => item.pass).length / scored.length : null,
      results
    };
  }

  async load() {
    if (this.loaded) return;
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'));
      this.custom = Array.isArray(payload?.skills) ? payload.skills : [];
      this.disabledBuiltins = new Set(Array.isArray(payload?.disabledBuiltins) ? payload.disabledBuiltins : []);
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger?.warn?.({ event: 'skill_store_load_failed', reason: error?.message || 'unknown' });
      this.custom = [];
      this.disabledBuiltins = new Set();
    }
    this.loaded = true;
  }

  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, disabledBuiltins: [...this.disabledBuiltins], skills: this.custom }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
  }
}

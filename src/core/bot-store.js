import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_WORKSPACE = 'workspace_default';
const PURPOSES = new Set(['sales', 'customer-care', 'support', 'custom']);
const MODES = new Set(['ai', 'scenario', 'hybrid']);
const STATUSES = new Set(['draft', 'running', 'paused']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class BotStore {
  constructor({ file = './data/state/bots.json', logger } = {}) {
    this.file = path.resolve(file);
    this.logger = logger;
    this.loaded = false;
    this.bots = [];
  }

  async list(workspaceId = DEFAULT_WORKSPACE) {
    await this.load();
    return clone(this.bots.filter((bot) => bot.workspaceId === workspaceId));
  }

  async get(id, workspaceId = DEFAULT_WORKSPACE) {
    await this.load();
    const bot = this.bots.find((item) => item.id === id && item.workspaceId === workspaceId);
    return bot ? clone(bot) : null;
  }

  async create(input = {}, workspaceId = DEFAULT_WORKSPACE) {
    await this.load();
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw new Error('bot_name_required');
    const now = new Date().toISOString();
    const bot = {
      id: `bot_${randomUUID()}`,
      workspaceId,
      name,
      purpose: PURPOSES.has(input.purpose) ? input.purpose : 'customer-care',
      intelligenceMode: MODES.has(input.intelligenceMode) ? input.intelligenceMode : 'hybrid',
      status: 'draft',
      description: String(input.description || '').trim().slice(0, 500),
      channels: [],
      knowledgeSources: [],
      scenario: { template: null, rules: [], notes: '' },
      ai: {
        enabled: true,
        modelMode: 'automatic',
        personality: 'Helpful · Professional · Vietnamese',
        handoffConfidenceBelow: 0.7
      },
      metrics: { conversations: 0, automatedRate: 0, customers: 0 },
      createdAt: now,
      updatedAt: now
    };
    this.bots.push(bot);
    await this.persist();
    return clone(bot);
  }

  async update(id, patch = {}, workspaceId = DEFAULT_WORKSPACE) {
    await this.load();
    const bot = this.bots.find((item) => item.id === id && item.workspaceId === workspaceId);
    if (!bot) return null;
    if (patch.name != null) {
      const name = String(patch.name).trim().slice(0, 80);
      if (name) bot.name = name;
    }
    if (PURPOSES.has(patch.purpose)) bot.purpose = patch.purpose;
    if (MODES.has(patch.intelligenceMode)) bot.intelligenceMode = patch.intelligenceMode;
    if (STATUSES.has(patch.status)) bot.status = patch.status;
    if (patch.description != null) bot.description = String(patch.description).trim().slice(0, 500);
    if (patch.ai && typeof patch.ai === 'object') {
      bot.ai = {
        ...bot.ai,
        ...(typeof patch.ai.enabled === 'boolean' ? { enabled: patch.ai.enabled } : {}),
        ...(patch.ai.modelMode === 'automatic' || patch.ai.modelMode === 'advanced' ? { modelMode: patch.ai.modelMode } : {}),
        ...(patch.ai.personality ? { personality: String(patch.ai.personality).slice(0, 180) } : {}),
        ...(Number.isFinite(Number(patch.ai.handoffConfidenceBelow)) ? { handoffConfidenceBelow: Math.max(0, Math.min(1, Number(patch.ai.handoffConfidenceBelow))) } : {})
      };
    }
    bot.updatedAt = new Date().toISOString();
    await this.persist();
    return clone(bot);
  }

  async upsertChannel(id, channel, patch = {}, workspaceId = DEFAULT_WORKSPACE) {
    await this.load();
    const bot = this.bots.find((item) => item.id === id && item.workspaceId === workspaceId);
    if (!bot) return null;
    let item = bot.channels.find((entry) => entry.channel === channel);
    if (!item) {
      item = { channel, status: 'not_connected', connectionId: null, connectedAt: null };
      bot.channels.push(item);
    }
    Object.assign(item, patch);
    bot.updatedAt = new Date().toISOString();
    await this.persist();
    return clone(bot);
  }

  async addKnowledgeSource(id, source = {}, workspaceId = DEFAULT_WORKSPACE) {
    await this.load();
    const bot = this.bots.find((item) => item.id === id && item.workspaceId === workspaceId);
    if (!bot) return null;
    const type = ['text', 'repository', 'url', 'document'].includes(source.type) ? source.type : 'text';
    const value = String(source.value || '').trim().slice(0, 4000);
    if (!value) throw new Error('knowledge_value_required');
    bot.knowledgeSources.push({
      id: `knowledge_${randomUUID()}`,
      type,
      name: String(source.name || type).trim().slice(0, 120),
      value,
      status: 'ready',
      createdAt: new Date().toISOString()
    });
    bot.updatedAt = new Date().toISOString();
    await this.persist();
    return clone(bot);
  }

  async setScenario(id, scenario = {}, workspaceId = DEFAULT_WORKSPACE) {
    await this.load();
    const bot = this.bots.find((item) => item.id === id && item.workspaceId === workspaceId);
    if (!bot) return null;
    bot.scenario = {
      template: scenario.template ? String(scenario.template).slice(0, 64) : null,
      rules: Array.isArray(scenario.rules) ? scenario.rules.slice(0, 40).map((rule) => ({
        intent: String(rule.intent || 'general').slice(0, 40),
        response: String(rule.response || '').slice(0, 1200),
        handoff: Boolean(rule.handoff),
        useAi: Boolean(rule.useAi),
        instruction: String(rule.instruction || '').slice(0, 1400)
      })).filter((rule) => rule.response || rule.handoff || rule.useAi) : [],
      notes: String(scenario.notes || '').slice(0, 4000)
    };
    bot.updatedAt = new Date().toISOString();
    await this.persist();
    return clone(bot);
  }

  async load() {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.file, 'utf8');
      const payload = JSON.parse(raw);
      this.bots = Array.isArray(payload?.bots) ? payload.bots : [];
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger?.warn({ event: 'bot_store_load_failed', reason: error?.message || 'unknown' });
      this.bots = [];
    }
    this.loaded = true;
  }

  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, bots: this.bots }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
  }
}

const PROFILES = {
  'customer-service': [
    'knowledge.search', 'skill.search', 'scenario.resolve', 'memory.read', 'memory.write',
    'ai.reply', 'workflow.emit', 'channel.reply', 'human.handoff'
  ],
  'read-only': ['knowledge.search', 'skill.search', 'scenario.resolve', 'memory.read'],
  'human-assist': ['knowledge.search', 'skill.search', 'scenario.resolve', 'memory.read', 'memory.write', 'workflow.emit', 'human.handoff'],
  'scenario-only': ['knowledge.search', 'skill.search', 'scenario.resolve', 'memory.read', 'memory.write', 'workflow.emit', 'channel.reply', 'human.handoff']
};

const KNOWN = new Set(Object.values(PROFILES).flat());

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => KNOWN.has(item)))];
}

export class ToolPolicy {
  resolve(bot = null) {
    const profile = bot?.toolPolicy?.profile && PROFILES[bot.toolPolicy.profile] ? bot.toolPolicy.profile : 'customer-service';
    const set = new Set(PROFILES[profile]);
    for (const capability of cleanList(bot?.toolPolicy?.allow)) set.add(capability);
    for (const capability of cleanList(bot?.toolPolicy?.deny)) set.delete(capability);
    if (bot?.intelligenceMode === 'scenario') set.delete('ai.reply');
    return { profile, capabilities: [...set] };
  }

  allows(bot, capability) {
    return this.resolve(bot).capabilities.includes(capability);
  }

  listProfiles() {
    return Object.entries(PROFILES).map(([id, capabilities]) => ({ id, capabilities: [...capabilities] }));
  }

  static knownCapabilities() {
    return [...KNOWN].sort();
  }
}

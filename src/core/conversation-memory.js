function cleanText(value, maxChars = 2000) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxChars);
}

function keyPart(value, fallback) {
  const clean = String(value || fallback || '').replace(/[:\u0000\r\n]/g, '_').trim();
  return clean || fallback;
}

export class ConversationMemory {
  constructor({ maxTurns = 12 } = {}) {
    this.maxMessages = Math.max(2, Math.min(Number(maxTurns) || 12, 40)) * 2;
    this.sessions = new Map();
  }

  key({ botId = 'global', channel = 'unknown', conversationId = 'direct', senderId = 'anonymous' } = {}) {
    return [
      keyPart(botId, 'global'),
      keyPart(channel, 'unknown'),
      keyPart(conversationId, 'direct'),
      keyPart(senderId, 'anonymous')
    ].join(':');
  }

  history(key, { limit = this.maxMessages } = {}) {
    const items = this.sessions.get(key) || [];
    return items.slice(-Math.max(1, Math.min(Number(limit) || this.maxMessages, this.maxMessages))).map((item) => ({ ...item }));
  }

  remember(key, message = {}) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = cleanText(message.content);
    if (!content) return;
    const items = this.sessions.get(key) || [];
    items.push({ role, content, at: new Date().toISOString() });
    if (items.length > this.maxMessages) items.splice(0, items.length - this.maxMessages);
    this.sessions.set(key, items);
  }

  clear(key) {
    this.sessions.delete(key);
  }

  snapshot() {
    return { sessions: this.sessions.size, maxMessagesPerSession: this.maxMessages };
  }
}

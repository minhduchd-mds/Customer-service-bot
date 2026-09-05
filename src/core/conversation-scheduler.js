export class ConversationQueueFullError extends Error {
  constructor(key, scope = 'conversation') {
    super('conversation_queue_full');
    this.name = 'ConversationQueueFullError';
    this.code = 'conversation_queue_full';
    this.key = key;
    this.scope = scope;
  }
}

function keyPart(value, fallback) {
  const normalized = String(value || fallback || '').replace(/[:\u0000\r\n]/g, '_').trim();
  return normalized || fallback;
}

export class ConversationScheduler {
  constructor({ maxPending = 256, maxPerConversation = 12 } = {}) {
    this.maxPending = Math.max(8, Math.min(Number(maxPending) || 256, 5000));
    this.maxPerConversation = Math.max(1, Math.min(Number(maxPerConversation) || 12, 100));
    this.queues = new Map();
    this.pending = 0;
    this.rejected = 0;
  }

  key({ botId = 'global', channel = 'unknown', conversationId = 'direct' } = {}) {
    return [
      keyPart(botId, 'global'),
      keyPart(channel, 'unknown'),
      keyPart(conversationId, 'direct')
    ].join(':');
  }

  run(key, task) {
    if (typeof task !== 'function') throw new TypeError('task must be a function');
    const queueKey = keyPart(key, 'global:unknown:direct');
    const current = this.queues.get(queueKey) || { tail: Promise.resolve(), pending: 0 };

    if (this.pending >= this.maxPending) {
      this.rejected += 1;
      throw new ConversationQueueFullError(queueKey, 'global');
    }
    if (current.pending >= this.maxPerConversation) {
      this.rejected += 1;
      throw new ConversationQueueFullError(queueKey, 'conversation');
    }

    current.pending += 1;
    this.pending += 1;
    this.queues.set(queueKey, current);

    const execution = current.tail.catch(() => undefined).then(() => task());
    const settled = execution.finally(() => {
      current.pending -= 1;
      this.pending -= 1;
      if (current.pending === 0 && this.queues.get(queueKey) === current) this.queues.delete(queueKey);
    });

    // The queue tail must never keep a rejection that blocks the next task.
    current.tail = settled.catch(() => undefined);
    return settled;
  }

  snapshot() {
    return {
      conversations: this.queues.size,
      pending: this.pending,
      rejected: this.rejected,
      maxPending: this.maxPending,
      maxPerConversation: this.maxPerConversation
    };
  }
}

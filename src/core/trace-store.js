import { randomUUID } from 'node:crypto';

function copyTrace(trace) {
  return JSON.parse(JSON.stringify(trace));
}

export class TraceStore {
  constructor({ limit = 250 } = {}) {
    this.limit = Math.max(20, Math.min(Number(limit) || 250, 2000));
    this.items = [];
  }

  record(input = {}) {
    const trace = {
      id: `trace_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      status: input.status || 'completed',
      botId: input.botId || null,
      channel: input.channel || null,
      eventId: input.eventId || null,
      intent: input.intent || null,
      skill: input.skill || null,
      skillSource: input.skillSource || null,
      responseSource: input.responseSource || null,
      handoff: Boolean(input.handoff),
      outboundDelivered: Boolean(input.outboundDelivered),
      durationMs: Math.max(0, Number(input.durationMs) || 0),
      stages: Array.isArray(input.stages) ? input.stages.map((stage) => ({ ...stage })) : [],
      error: input.error ? String(input.error).slice(0, 240) : null
    };
    this.items.push(trace);
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
    return trace.id;
  }

  list({ botId = null, limit = 50 } = {}) {
    return this.items
      .filter((trace) => !botId || trace.botId === botId)
      .slice(-Math.max(1, Math.min(Number(limit) || 50, 200)))
      .reverse()
      .map(copyTrace);
  }

  get(id) {
    const trace = this.items.find((item) => item.id === id);
    return trace ? copyTrace(trace) : null;
  }

  snapshot() {
    return { traces: this.items.length, limit: this.limit };
  }
}

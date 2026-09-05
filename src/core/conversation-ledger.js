import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const CONVERSATION_STATUSES = new Set(['open', 'handoff', 'resolved', 'archived']);
const TICKET_STATUSES = new Set(['open', 'pending', 'resolved', 'closed']);
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function cleanText(value, maxChars = 8000) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, Math.max(1, Number(maxChars) || 8000));
}

function hash(value, size = 24) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, size);
}

function luhnValid(value) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactSensitiveContent(value, maxChars = 8000) {
  let text = cleanText(value, maxChars);
  text = text.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, '[PRIVATE_KEY_REDACTED]');
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}\b/gi, 'Bearer [REDACTED]');
  text = text.replace(/\b(password|passcode|mật khẩu|mat khau|otp|cvv|cvc|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
  text = text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (candidate) => luhnValid(candidate) ? '[PAYMENT_CARD_REDACTED]' : candidate);
  return text;
}

function isoNow(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function conversationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    channel: row.channel,
    senderRef: row.sender_ref,
    status: row.status,
    unreadCount: Number(row.unread_count || 0),
    lastIntent: row.last_intent,
    lastSkill: row.last_skill,
    responseSource: row.response_source,
    lastExcerpt: row.last_excerpt,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ticketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    botId: row.bot_id,
    channel: row.channel,
    status: row.status,
    priority: row.priority,
    reason: row.reason,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ConversationLedger {
  constructor({ file = './data/state/conversations.sqlite', retentionDays = 30, maxMessageChars = 8000, logger, now = () => new Date() } = {}) {
    this.file = path.resolve(file);
    this.retentionDays = Math.max(1, Math.min(Number(retentionDays) || 30, 3650));
    this.maxMessageChars = Math.max(256, Math.min(Number(maxMessageChars) || 8000, 32000));
    this.logger = logger;
    this.now = now;
    this.lastPruneAt = 0;
    mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        provider_conversation_id TEXT NOT NULL,
        provider_sender_id TEXT NOT NULL,
        sender_ref TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_intent TEXT,
        last_skill TEXT,
        response_source TEXT,
        last_excerpt TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(bot_id, channel, provider_conversation_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        role TEXT NOT NULL,
        direction TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(conversation_id, event_id, direction)
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'normal',
        reason TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_bot_status ON conversations(bot_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_tickets_bot_status ON tickets(bot_id, status, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_active_conversation ON tickets(conversation_id) WHERE status IN ('open','pending');
    `);
    this.prune();
  }

  async recordTurn({ botId = null, event, intent = null, skill = null, reply = '', handoff = false, responseSource = null } = {}) {
    if (!event?.channel) return { stored: false, reason: 'missing_event' };
    this.maybePrune();
    const effectiveBotId = cleanText(botId || 'global', 128);
    const channel = cleanText(event.channel, 40);
    const providerConversationId = cleanText(event.conversationId || event.chatId || event.senderId || event.eventId, 256);
    const providerSenderId = cleanText(event.senderId || providerConversationId || 'anonymous', 256);
    const eventId = cleanText(event.eventId || `event-${randomUUID()}`, 256);
    if (!providerConversationId) return { stored: false, reason: 'missing_conversation_id' };
    const conversationId = `conv_${hash(`${effectiveBotId}:${channel}:${providerConversationId}`)}`;
    const senderRef = `customer_${hash(`${channel}:${providerSenderId}`, 12)}`;
    const now = isoNow(this.now);
    const inbound = redactSensitiveContent(event.text || '', this.maxMessageChars);
    const outbound = redactSensitiveContent(reply || '', this.maxMessageChars);
    const nextStatus = handoff ? 'handoff' : 'open';
    let ticket = null;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = this.db.prepare('SELECT 1 AS found FROM messages WHERE conversation_id=? AND event_id=? LIMIT 1').get(conversationId, eventId);
      if (duplicate) {
        const activeTicket = ticketRow(this.db.prepare(`SELECT * FROM tickets WHERE conversation_id=? AND status IN ('open','pending') ORDER BY created_at ASC LIMIT 1`).get(conversationId));
        this.db.exec('COMMIT');
        return { stored: true, duplicate: true, conversationId, ticketId: activeTicket?.id || null };
      }

      this.db.prepare(`
        INSERT INTO conversations (
          id, bot_id, channel, provider_conversation_id, provider_sender_id, sender_ref,
          status, unread_count, last_intent, last_skill, response_source, last_excerpt, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider_sender_id=excluded.provider_sender_id,
          sender_ref=excluded.sender_ref,
          status=CASE
            WHEN excluded.status='handoff' THEN 'handoff'
            WHEN conversations.status='handoff' THEN 'handoff'
            ELSE 'open'
          END,
          unread_count=conversations.unread_count + 1,
          last_intent=excluded.last_intent,
          last_skill=excluded.last_skill,
          response_source=excluded.response_source,
          last_excerpt=excluded.last_excerpt,
          updated_at=excluded.updated_at
      `).run(
        conversationId,
        effectiveBotId,
        channel,
        providerConversationId,
        providerSenderId,
        senderRef,
        nextStatus,
        cleanText(intent, 80) || null,
        cleanText(skill?.slug || skill?.id || skill, 128) || null,
        cleanText(responseSource, 80) || null,
        inbound.slice(0, 360),
        now,
        now
      );

      if (inbound) {
        this.db.prepare(`INSERT OR IGNORE INTO messages (id, conversation_id, event_id, role, direction, content, created_at) VALUES (?, ?, ?, 'user', 'inbound', ?, ?)`)
          .run(`msg_${hash(`${conversationId}:${eventId}:in`)}`, conversationId, eventId, inbound, now);
      }
      if (outbound) {
        this.db.prepare(`INSERT OR IGNORE INTO messages (id, conversation_id, event_id, role, direction, content, created_at) VALUES (?, ?, ?, 'assistant', 'outbound', ?, ?)`)
          .run(`msg_${hash(`${conversationId}:${eventId}:out`)}`, conversationId, eventId, outbound, now);
      }

      if (handoff) {
        const ticketId = `ticket_${randomUUID()}`;
        const summary = inbound.slice(0, 600) || 'Human handoff requested by the runtime.';
        this.db.prepare(`INSERT OR IGNORE INTO tickets (id, conversation_id, bot_id, channel, status, priority, reason, summary, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', 'normal', 'human_handoff', ?, ?, ?)`)
          .run(ticketId, conversationId, effectiveBotId, channel, summary, now, now);
        ticket = ticketRow(this.db.prepare(`SELECT * FROM tickets WHERE conversation_id=? AND status IN ('open','pending') ORDER BY created_at ASC LIMIT 1`).get(conversationId));
      }

      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }

    return { stored: true, conversationId, ticketId: ticket?.id || null };
  }

  listConversations({ botId = null, status = null, query = '', limit = 50 } = {}) {
    this.maybePrune();
    const conditions = [];
    const params = [];
    if (botId) { conditions.push('bot_id=?'); params.push(cleanText(botId, 128)); }
    if (status) {
      if (!CONVERSATION_STATUSES.has(status)) throw Object.assign(new Error('invalid_conversation_status'), { code: 'invalid_conversation_status' });
      conditions.push('status=?'); params.push(status);
    }
    const q = cleanText(query, 120);
    if (q) {
      conditions.push('(last_excerpt LIKE ? OR sender_ref LIKE ? OR channel LIKE ?)');
      const term = `%${q}%`;
      params.push(term, term, term);
    }
    const sql = `SELECT * FROM conversations ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`;
    params.push(Math.max(1, Math.min(Number(limit) || 50, 200)));
    return this.db.prepare(sql).all(...params).map(conversationRow);
  }

  getConversation(id, { messageLimit = 100 } = {}) {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(cleanText(id, 128));
    if (!row) return null;
    const messages = this.db.prepare('SELECT id, event_id, role, direction, content, created_at FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT ?')
      .all(row.id, Math.max(1, Math.min(Number(messageLimit) || 100, 500)))
      .map((item) => ({ id: item.id, eventId: item.event_id, role: item.role, direction: item.direction, content: item.content, createdAt: item.created_at }));
    const tickets = this.db.prepare('SELECT * FROM tickets WHERE conversation_id=? ORDER BY created_at DESC').all(row.id).map(ticketRow);
    return {
      ...conversationRow(row),
      providerConversationId: row.provider_conversation_id,
      messages,
      tickets
    };
  }

  updateConversation(id, patch = {}) {
    const current = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(cleanText(id, 128));
    if (!current) return null;
    const status = patch.status == null ? current.status : String(patch.status);
    if (!CONVERSATION_STATUSES.has(status)) throw Object.assign(new Error('invalid_conversation_status'), { code: 'invalid_conversation_status' });
    const unreadCount = patch.markRead === true ? 0 : Number(current.unread_count || 0);
    const now = isoNow(this.now);
    this.db.prepare('UPDATE conversations SET status=?, unread_count=?, updated_at=? WHERE id=?').run(status, unreadCount, now, current.id);
    return conversationRow(this.db.prepare('SELECT * FROM conversations WHERE id=?').get(current.id));
  }

  deleteConversation(id) {
    const result = this.db.prepare('DELETE FROM conversations WHERE id=?').run(cleanText(id, 128));
    return Number(result.changes || 0) > 0;
  }

  listTickets({ botId = null, status = null, limit = 50 } = {}) {
    const conditions = [];
    const params = [];
    if (botId) { conditions.push('bot_id=?'); params.push(cleanText(botId, 128)); }
    if (status) {
      if (!TICKET_STATUSES.has(status)) throw Object.assign(new Error('invalid_ticket_status'), { code: 'invalid_ticket_status' });
      conditions.push('status=?'); params.push(status);
    }
    const sql = `SELECT * FROM tickets ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`;
    params.push(Math.max(1, Math.min(Number(limit) || 50, 200)));
    return this.db.prepare(sql).all(...params).map(ticketRow);
  }

  updateTicket(id, patch = {}) {
    const current = this.db.prepare('SELECT * FROM tickets WHERE id=?').get(cleanText(id, 128));
    if (!current) return null;
    const status = patch.status == null ? current.status : String(patch.status);
    const priority = patch.priority == null ? current.priority : String(patch.priority);
    if (!TICKET_STATUSES.has(status)) throw Object.assign(new Error('invalid_ticket_status'), { code: 'invalid_ticket_status' });
    if (!TICKET_PRIORITIES.has(priority)) throw Object.assign(new Error('invalid_ticket_priority'), { code: 'invalid_ticket_priority' });
    const now = isoNow(this.now);
    this.db.prepare('UPDATE tickets SET status=?, priority=?, updated_at=? WHERE id=?').run(status, priority, now, current.id);
    if (status === 'resolved' || status === 'closed') {
      this.db.prepare("UPDATE conversations SET status='resolved', updated_at=? WHERE id=? AND status='handoff'").run(now, current.conversation_id);
    }
    return ticketRow(this.db.prepare('SELECT * FROM tickets WHERE id=?').get(current.id));
  }

  prune() {
    const nowMs = new Date(this.now()).getTime();
    const cutoff = new Date(nowMs - (this.retentionDays * 86400_000)).toISOString();
    const result = this.db.prepare(`DELETE FROM conversations WHERE updated_at < ? AND id NOT IN (SELECT conversation_id FROM tickets WHERE status IN ('open','pending'))`).run(cutoff);
    this.lastPruneAt = nowMs;
    return { removedConversations: Number(result.changes || 0), cutoff };
  }

  maybePrune() {
    const current = new Date(this.now()).getTime();
    if (current - this.lastPruneAt >= 3600_000) this.prune();
  }

  snapshot() {
    const conversations = this.db.prepare('SELECT COUNT(*) AS count FROM conversations').get()?.count || 0;
    const openTickets = this.db.prepare("SELECT COUNT(*) AS count FROM tickets WHERE status IN ('open','pending')").get()?.count || 0;
    return { backend: 'sqlite', conversations: Number(conversations), openTickets: Number(openTickets), retentionDays: this.retentionDays };
  }

  close() {
    this.db?.close();
  }
}

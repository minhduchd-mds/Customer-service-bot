import { classifyIntent } from './intent.js';
import { selectSkill } from '../skills/catalog.js';

export class Router9 {
  constructor({ idempotency, knowledge, ai, workflow, logger }) {
    this.idempotency = idempotency;
    this.knowledge = knowledge;
    this.ai = ai;
    this.workflow = workflow;
    this.logger = logger;
    this.metrics = {
      received: 0,
      verified: 0,
      rejected: 0,
      duplicates: 0,
      processed: 0,
      outboundDelivered: 0,
      outboundSkipped: 0
    };
  }

  async handle({ connector, rawBody, payload, headers = {}, url, dispatch = true, skipVerification = false }) {
    const trace = [];
    this.metrics.received += 1;

    // 1. Ingress
    trace.push({ stage: 1, name: 'ingress', ok: true });

    // 2. Authenticity
    const verification = skipVerification ? { ok: true, reason: 'simulation' } : connector.verify({ headers, rawBody, payload, url });
    trace.push({ stage: 2, name: 'authenticity', ...verification });
    if (!verification.ok) {
      this.metrics.rejected += 1;
      return { accepted: false, statusCode: 401, reason: verification.reason || 'verification_failed', trace };
    }
    this.metrics.verified += 1;

    // 3. Normalize
    const event = connector.normalize(payload);
    const normalized = Boolean(event?.channel && event?.eventId);
    trace.push({ stage: 3, name: 'normalize', ok: normalized, eventId: event?.eventId || '' });
    if (!normalized) {
      this.metrics.rejected += 1;
      return { accepted: false, statusCode: 422, reason: 'normalization_failed', trace };
    }

    // 4. Idempotency
    const dedupeKey = `${event.channel}:${event.eventId}`;
    const duplicate = this.idempotency.seen(dedupeKey);
    trace.push({ stage: 4, name: 'idempotency', ok: true, duplicate });
    if (duplicate) {
      this.metrics.duplicates += 1;
      return { accepted: true, duplicate: true, event, trace };
    }

    // 5. Policy
    const policy = this.applyPolicy(event);
    trace.push({ stage: 5, name: 'policy', ok: policy.ok, action: policy.action });
    if (!policy.ok) {
      this.metrics.processed += 1;
      await this.workflow.emit('conversation.ignored', { event: this.publicEvent(event), reason: policy.reason });
      return { accepted: true, ignored: true, reason: policy.reason, event, trace };
    }

    // 6. Intent + runtime skill
    const intent = classifyIntent(event.text);
    const skill = selectSkill(intent);
    trace.push({ stage: 6, name: 'intent-skill', ok: true, intent, skill: skill.id });

    // 7. Knowledge
    const knowledge = event.text ? await this.knowledge.search(event.text, { limit: 4 }) : [];
    trace.push({ stage: 7, name: 'knowledge', ok: true, matches: knowledge.length });

    // 8. Response
    const reply = event.replyAllowed ? await this.ai.reply({ event, intent, skill, knowledge }) : '';
    trace.push({ stage: 8, name: 'response', ok: true, generated: Boolean(reply), provider: this.ai.enabled ? 'ai' : 'fallback' });

    // 9. Workflow + dispatch + observability
    const workflowResult = await this.workflow.emit('conversation.processed', {
      event: this.publicEvent(event), intent, skill: skill.id, knowledge: knowledge.map(({ path, score }) => ({ path, score })), reply
    });
    let outbound = { delivered: false, reason: dispatch ? 'not_replyable' : 'simulation' };
    if (dispatch && reply && event.replyAllowed) {
      try {
        outbound = await connector.send(event, reply);
      } catch (error) {
        outbound = { delivered: false, reason: 'send_failed' };
        this.logger?.error({ event: 'outbound_send_failed', channel: event.channel, reason: error?.message || 'unknown' });
      }
    }
    outbound.delivered ? this.metrics.outboundDelivered++ : this.metrics.outboundSkipped++;
    this.metrics.processed += 1;
    trace.push({ stage: 9, name: 'workflow-dispatch-observe', ok: true, workflow: workflowResult.delivered, outbound: outbound.delivered });
    this.logger?.info({ event: 'message_processed', channel: event.channel, intent, eventId: event.eventId, outbound: outbound.delivered });

    return { accepted: true, event: this.publicEvent(event), intent, skill, knowledge, reply, outbound, workflow: workflowResult, trace };
  }

  applyPolicy(event) {
    if (!event.text && event.eventType === 'message') return { ok: false, action: 'ignore', reason: 'empty_message' };
    if (!event.text && !event.replyAllowed) return { ok: false, action: 'workflow-only', reason: 'non_message_event' };
    return { ok: true, action: 'respond' };
  }

  publicEvent(event) {
    const { raw, ...safe } = event;
    return safe;
  }

  snapshotMetrics() {
    return { ...this.metrics, idempotencyKeys: this.idempotency.size };
  }
}

import { classifyIntent } from './intent.js';
import { resolveScenario } from './scenario.js';
import { selectSkill as selectBuiltinSkill } from '../skills/catalog.js';

function publicSkill(skill) {
  if (!skill) return null;
  const { instructions, fileHash, ...safe } = skill;
  return safe;
}

export class Router9 {
  constructor({ idempotency, knowledge, ai, workflow, logger, skills = null, toolPolicy = null, memory = null, traces = null }) {
    this.idempotency = idempotency;
    this.knowledge = knowledge;
    this.ai = ai;
    this.workflow = workflow;
    this.logger = logger;
    this.skills = skills;
    this.toolPolicy = toolPolicy;
    this.memory = memory;
    this.traces = traces;
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

  async handle({ connector, rawBody, payload, headers = {}, url, dispatch = true, skipVerification = false, bot = null }) {
    const startedAt = Date.now();
    const trace = [];
    let event = null;
    let intent = null;
    let skill = null;
    let responseSource = 'none';
    let aiProvider = null;
    let handoff = false;
    let outbound = { delivered: false, reason: dispatch ? 'not_replyable' : 'simulation' };
    const capability = (name) => this.toolPolicy ? this.toolPolicy.allows(bot, name) : true;
    const runtimePolicy = this.toolPolicy?.resolve(bot) || { profile: 'legacy', capabilities: [] };

    this.metrics.received += 1;
    trace.push({ stage: 1, name: 'ingress', ok: true, botId: bot?.id || null });

    const verification = skipVerification ? { ok: true, reason: 'simulation' } : connector.verify({ headers, rawBody, payload, url });
    trace.push({ stage: 2, name: 'authenticity', ...verification });
    if (!verification.ok) {
      this.metrics.rejected += 1;
      return this.finish({ accepted: false, statusCode: 401, reason: verification.reason || 'verification_failed', trace }, { startedAt, bot, event, intent, skill, responseSource, handoff, outbound });
    }
    this.metrics.verified += 1;

    event = connector.normalize(payload);
    const normalized = Boolean(event?.channel && event?.eventId);
    trace.push({ stage: 3, name: 'normalize', ok: normalized, eventId: event?.eventId || '' });
    if (!normalized) {
      this.metrics.rejected += 1;
      return this.finish({ accepted: false, statusCode: 422, reason: 'normalization_failed', trace }, { startedAt, bot, event, intent, skill, responseSource, handoff, outbound });
    }

    const dedupeKey = `${bot?.id || 'global'}:${event.channel}:${event.eventId}`;
    const duplicate = this.idempotency.seen(dedupeKey);
    trace.push({ stage: 4, name: 'idempotency', ok: true, duplicate });
    if (duplicate) {
      this.metrics.duplicates += 1;
      return this.finish({ accepted: true, duplicate: true, event: this.publicEvent(event), botId: bot?.id || null, trace }, { startedAt, bot, event, intent, skill, responseSource, handoff, outbound });
    }

    const policy = this.applyPolicy(event);
    trace.push({ stage: 5, name: 'policy', ok: policy.ok, action: policy.action, toolProfile: runtimePolicy.profile });
    if (!policy.ok) {
      this.metrics.processed += 1;
      if (capability('workflow.emit')) await this.workflow.emit('conversation.ignored', { botId: bot?.id || null, event: this.publicEvent(event), reason: policy.reason });
      return this.finish({ accepted: true, ignored: true, reason: policy.reason, event: this.publicEvent(event), botId: bot?.id || null, trace }, { startedAt, bot, event, intent, skill, responseSource, handoff, outbound });
    }

    intent = classifyIntent(event.text);
    skill = this.skills
      ? await this.skills.select({ intent, text: event.text, bot })
      : selectBuiltinSkill(intent);
    const skillId = skill?.slug || skill?.id || 'none';
    trace.push({ stage: 6, name: 'intent-skill', ok: true, intent, skill: skillId, skillSource: skill?.source || null, matchReason: skill?.matchReason || 'intent', mode: bot?.intelligenceMode || 'hybrid' });

    const repositoryKnowledge = capability('knowledge.search') && event.text ? await this.knowledge.search(event.text, { limit: 4 }) : [];
    const botKnowledge = capability('knowledge.search') && Array.isArray(bot?.knowledgeSources) ? bot.knowledgeSources.slice(0, 8) : [];
    const memoryKey = this.memory?.key({
      botId: bot?.id || 'global',
      channel: event.channel,
      conversationId: event.conversationId || event.chatId || event.senderId || 'direct',
      senderId: event.senderId || 'anonymous'
    });
    const history = capability('memory.read') && this.memory && memoryKey ? this.memory.history(memoryKey) : [];
    trace.push({ stage: 7, name: 'knowledge', ok: true, matches: repositoryKnowledge.length, botSources: botKnowledge.length, memoryTurns: Math.ceil(history.length / 2) });

    let reply = '';
    if (event.replyAllowed) {
      const scenario = capability('scenario.resolve') ? resolveScenario(bot, intent) : null;
      if (scenario?.useAi) {
        const context = { event, intent, skill, knowledge: repositoryKnowledge, bot, botKnowledge, history, scenarioInstruction: scenario.instruction };
        if (capability('ai.reply')) {
          const result = await this.aiResult(context);
          reply = result.text;
          aiProvider = result.provider;
          responseSource = result.source === 'ai' ? 'scenario-ai' : 'scenario-grounded-fallback';
        } else {
          reply = this.ai.fallback?.(context) || '';
          responseSource = 'scenario-grounded-fallback';
        }
        handoff = scenario.handoff;
      } else if (scenario?.response) {
        reply = scenario.response;
        handoff = scenario.handoff;
        responseSource = 'scenario';
      } else if (bot?.intelligenceMode === 'scenario' || !capability('ai.reply')) {
        const context = { event, intent, skill, knowledge: repositoryKnowledge, bot, botKnowledge, history };
        reply = bot?.intelligenceMode === 'scenario'
          ? 'Mình chưa có kịch bản phù hợp cho yêu cầu này. Mình sẽ chuyển nội dung sang nhân viên hỗ trợ để xử lý tiếp.'
          : this.ai.fallback?.(context) || '';
        handoff = bot?.intelligenceMode === 'scenario';
        responseSource = bot?.intelligenceMode === 'scenario' ? 'scenario-fallback' : 'policy-fallback';
      } else {
        const result = await this.aiResult({ event, intent, skill, knowledge: repositoryKnowledge, bot, botKnowledge, history });
        reply = result.text;
        aiProvider = result.provider;
        responseSource = result.source === 'ai' ? 'ai' : 'fallback';
      }
    }
    trace.push({
      stage: 8,
      name: 'response',
      ok: true,
      generated: Boolean(reply),
      provider: responseSource,
      aiProvider: aiProvider?.name || null,
      aiModel: aiProvider?.model || null,
      handoff
    });

    let workflowResult = { delivered: false, reason: 'policy_disabled' };
    if (capability('workflow.emit')) {
      workflowResult = await this.workflow.emit('conversation.processed', {
        botId: bot?.id || null,
        botName: bot?.name || null,
        event: this.publicEvent(event),
        intent,
        skill: skillId,
        mode: bot?.intelligenceMode || 'hybrid',
        handoff,
        knowledge: repositoryKnowledge.map(({ path, score }) => ({ path, score })),
        reply
      });
    }

    if (dispatch && reply && event.replyAllowed && capability('channel.reply')) {
      try {
        outbound = await connector.send(event, reply);
      } catch (error) {
        outbound = { delivered: false, reason: 'send_failed' };
        this.logger?.error({ event: 'outbound_send_failed', botId: bot?.id || null, channel: event.channel, reason: error?.message || 'unknown' });
      }
    } else if (dispatch && !capability('channel.reply')) {
      outbound = { delivered: false, reason: 'tool_policy_disabled' };
    }

    if (capability('memory.write') && this.memory && memoryKey) {
      if (event.text) this.memory.remember(memoryKey, { role: 'user', content: event.text });
      if (reply) this.memory.remember(memoryKey, { role: 'assistant', content: reply });
    }

    outbound.delivered ? this.metrics.outboundDelivered++ : this.metrics.outboundSkipped++;
    this.metrics.processed += 1;
    trace.push({ stage: 9, name: 'workflow-dispatch-observe', ok: true, workflow: workflowResult.delivered, outbound: outbound.delivered });
    this.logger?.info({ event: 'message_processed', botId: bot?.id || null, channel: event.channel, intent, skill: skillId, eventId: event.eventId, outbound: outbound.delivered });

    return this.finish({
      accepted: true,
      botId: bot?.id || null,
      event: this.publicEvent(event),
      intent,
      skill: publicSkill(skill),
      knowledge: repositoryKnowledge,
      responseSource,
      aiProvider,
      handoff,
      reply,
      outbound,
      workflow: workflowResult,
      trace
    }, { startedAt, bot, event, intent, skill, responseSource, handoff, outbound });
  }

  async aiResult(context) {
    if (typeof this.ai.replyDetailed === 'function') return this.ai.replyDetailed(context);
    const text = await this.ai.reply(context);
    return { text, source: this.ai.enabled ? 'ai' : 'fallback', provider: null };
  }

  finish(result, context) {
    const traceId = this.traces?.record({
      status: result.accepted === false ? 'rejected' : result.duplicate ? 'duplicate' : 'completed',
      botId: context.bot?.id || null,
      channel: context.event?.channel || null,
      eventId: context.event?.eventId || null,
      intent: context.intent,
      skill: context.skill?.slug || context.skill?.id || null,
      skillSource: context.skill?.source || null,
      responseSource: context.responseSource,
      handoff: context.handoff,
      outboundDelivered: context.outbound?.delivered,
      durationMs: Date.now() - context.startedAt,
      stages: result.trace || [],
      error: result.reason || null
    }) || null;
    return traceId ? { ...result, traceId } : result;
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
    return {
      ...this.metrics,
      idempotencyKeys: this.idempotency.size,
      memory: this.memory?.snapshot?.() || null,
      traces: this.traces?.snapshot?.() || null
    };
  }
}

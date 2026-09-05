export class WorkflowBridge {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  get enabled() {
    return Boolean(this.config.webhookUrl);
  }

  async emit(event, payload) {
    if (!this.enabled) return { delivered: false, reason: 'disabled' };
    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.sharedSecret ? { 'x-bot-workflow-secret': this.config.sharedSecret } : {})
        },
        body: JSON.stringify({ event, payload, emittedAt: new Date().toISOString() })
      });
      if (!response.ok) throw new Error(`n8n returned ${response.status}`);
      return { delivered: true };
    } catch (error) {
      this.logger?.warn({ event: 'n8n_delivery_failed', reason: error?.message || 'unknown' });
      return { delivered: false, reason: 'delivery_failed' };
    }
  }
}

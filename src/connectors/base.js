export function headerValue(headers, name) {
  const value = headers?.[name.toLowerCase()] ?? headers?.[name] ?? '';
  return Array.isArray(value) ? value[0] : String(value || '');
}

export function normalizedEvent(overrides = {}) {
  return {
    channel: 'unknown',
    eventId: '',
    eventType: 'message',
    senderId: '',
    conversationId: '',
    recipientId: '',
    text: '',
    timestamp: Date.now(),
    replyAllowed: true,
    raw: {},
    ...overrides
  };
}

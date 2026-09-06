const ACCOUNT_TYPES = Object.freeze([
  {
    id: 'zalo-oa', channel: 'zalo', label: 'Zalo Official Account', accountClass: 'business', authorization: 'official-provider',
    capabilities: { identityLogin: true, receiveMessages: true, sendMessages: true, webhook: true, autoReply: true },
    connectable: true, production: true,
    note: 'Customer-service messaging uses Zalo Official Account / approved Zalo developer capabilities. Bot Hub never reuses a personal Zalo browser session or cookie.'
  },
  {
    id: 'zalo-personal', channel: 'zalo', label: 'Zalo Personal', accountClass: 'personal', authorization: 'identity-only',
    capabilities: { identityLogin: true, receiveMessages: false, sendMessages: false, webhook: false, autoReply: false },
    connectable: false, production: false,
    note: 'Personal Zalo sign-in can identify a user when an official login product is available, but it is not treated as a customer-service inbox bot.'
  },
  {
    id: 'facebook-page', channel: 'facebook', label: 'Facebook Page', accountClass: 'business', authorization: 'oauth-page',
    capabilities: { identityLogin: true, receiveMessages: true, sendMessages: true, webhook: true, autoReply: true },
    connectable: true, production: true,
    note: 'Messenger automation requires a Page and the approved Meta permissions/tokens for that Page.'
  },
  {
    id: 'facebook-profile', channel: 'facebook', label: 'Facebook Personal Profile', accountClass: 'personal', authorization: 'identity-only',
    capabilities: { identityLogin: true, receiveMessages: false, sendMessages: false, webhook: false, autoReply: false },
    connectable: false, production: false,
    note: 'A personal Facebook profile is not exposed as a generic automated Messenger inbox in Bot Hub.'
  },
  {
    id: 'instagram-professional', channel: 'instagram', label: 'Instagram Professional', accountClass: 'business', authorization: 'meta-oauth',
    capabilities: { identityLogin: true, receiveMessages: true, sendMessages: true, webhook: true, autoReply: true },
    connectable: false, production: false,
    note: 'Instagram messaging requires an eligible Professional account and approved Meta permissions. The adapter is catalogued but not enabled in this release.'
  },
  {
    id: 'instagram-personal', channel: 'instagram', label: 'Instagram Personal', accountClass: 'personal', authorization: 'identity-only',
    capabilities: { identityLogin: true, receiveMessages: false, sendMessages: false, webhook: false, autoReply: false },
    connectable: false, production: false,
    note: 'Consumer Instagram accounts are not presented as automated Bot Hub messaging accounts.'
  },
  {
    id: 'telegram-bot', channel: 'telegram', label: 'Telegram Bot', accountClass: 'bot', authorization: 'bot-token',
    capabilities: { identityLogin: false, receiveMessages: true, sendMessages: true, webhook: true, autoReply: true },
    connectable: true, production: true,
    note: 'Uses an official BotFather bot token and Telegram webhook secret.'
  },
  {
    id: 'telegram-business', channel: 'telegram', label: 'Telegram Business connection', accountClass: 'business', authorization: 'business-connection',
    capabilities: { identityLogin: true, receiveMessages: true, sendMessages: true, webhook: true, autoReply: true },
    connectable: true, production: true,
    note: 'Uses Telegram Business bot connections and the rights granted by the business account. Bot Hub does not log in as a userbot.'
  },
  {
    id: 'tiktok-login', channel: 'tiktok', label: 'TikTok Login', accountClass: 'personal', authorization: 'oauth-identity',
    capabilities: { identityLogin: true, receiveMessages: false, sendMessages: false, webhook: false, autoReply: false },
    connectable: false, production: false,
    note: 'TikTok Login authorizes identity/data scopes only. It does not imply generic direct-message send permission.'
  },
  {
    id: 'tiktok-messaging', channel: 'tiktok', label: 'TikTok approved messaging', accountClass: 'business', authorization: 'approved-capability',
    capabilities: { identityLogin: true, receiveMessages: true, sendMessages: true, webhook: true, autoReply: true },
    connectable: false, production: false,
    note: 'Enabled only when the user account/app has an approved messaging product and the exact current provider API is configured.'
  },
  {
    id: 'web-widget', channel: 'web', label: 'Website Chat Widget', accountClass: 'owned', authorization: 'signed-widget',
    capabilities: { identityLogin: false, receiveMessages: true, sendMessages: true, webhook: false, autoReply: true },
    connectable: true, production: true,
    note: 'Bot Hub-owned web widget with signed, origin-bound embed grants.'
  }
]);

export function channelAccountCatalog({ connectorStatus = {} } = {}) {
  return ACCOUNT_TYPES.map((item) => {
    const adapter = connectorStatus[item.channel] || null;
    const adapterAvailable = item.channel === 'web' || Boolean(adapter);
    const runtimeReady = item.id === 'web-widget'
      ? true
      : item.connectable && adapterAvailable;
    return {
      ...item,
      capabilities: { ...item.capabilities },
      adapterAvailable,
      runtimeReady,
      configured: adapter ? Boolean(adapter.inboundConfigured || adapter.outboundConfigured) : item.channel === 'web'
    };
  });
}

export function channelAccountType(id) {
  const item = ACCOUNT_TYPES.find((entry) => entry.id === id);
  return item ? { ...item, capabilities: { ...item.capabilities } } : null;
}

export function canAutoReplyAccount(id) {
  const item = channelAccountType(id);
  return Boolean(item?.connectable && item.capabilities?.receiveMessages && item.capabilities?.sendMessages && item.capabilities?.autoReply);
}

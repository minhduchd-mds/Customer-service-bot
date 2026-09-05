const RULES = [
  { intent: 'handoff', words: ['nhân viên', 'tư vấn viên', 'gặp người', 'human', 'agent', 'complaint', 'khiếu nại'] },
  { intent: 'order-status', words: ['đơn hàng', 'order', 'giao hàng', 'shipping', 'tracking', 'vận chuyển'] },
  { intent: 'pricing', words: ['giá', 'price', 'bao nhiêu', 'chi phí', 'cost'] },
  { intent: 'sales', words: ['mua', 'đặt hàng', 'buy', 'purchase', 'tư vấn sản phẩm', 'product'] },
  { intent: 'support', words: ['lỗi', 'không hoạt động', 'error', 'support', 'hỗ trợ', 'help'] }
];

export function classifyIntent(text = '') {
  const value = text.toLocaleLowerCase('vi');
  for (const rule of RULES) {
    if (rule.words.some((word) => value.includes(word))) return rule.intent;
  }
  return value.trim() ? 'general' : 'event';
}

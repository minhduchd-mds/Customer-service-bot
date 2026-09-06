const RULES = [
  { intent: 'handoff', words: ['nhân viên', 'tư vấn viên', 'gặp người', 'human', 'agent', 'complaint', 'khiếu nại'] },
  { intent: 'order-status', words: ['đơn hàng', 'order', 'giao hàng', 'shipping', 'tracking', 'vận chuyển'] },
  { intent: 'product-compare', words: ['so sánh', 'khác nhau', 'compare', 'versus', ' vs ', 'nên chọn loại nào'] },
  { intent: 'product-intro', words: ['giới thiệu sản phẩm', 'giới thiệu giúp', 'sản phẩm này là gì', 'product introduction', 'tell me about this product', 'thông tin sản phẩm'] },
  { intent: 'product-recommendation', words: ['phù hợp với tôi', 'phù hợp nhu cầu', 'tư vấn chọn', 'nên mua loại nào', 'recommend', 'recommendation', 'gợi ý sản phẩm'] },
  { intent: 'promotion', words: ['khuyến mại', 'khuyến mãi', 'ưu đãi', 'voucher', 'promotion', 'discount', 'giảm giá'] },
  { intent: 'pricing', words: ['giá', 'price', 'bao nhiêu', 'chi phí', 'cost'] },
  { intent: 'sales', words: ['mua', 'đặt hàng', 'buy', 'purchase', 'tư vấn sản phẩm', 'product'] },
  { intent: 'support', words: ['lỗi', 'không hoạt động', 'error', 'support', 'hỗ trợ', 'help'] }
];

export function classifyIntent(text = '') {
  const value = ` ${String(text).toLocaleLowerCase('vi')} `;
  for (const rule of RULES) {
    if (rule.words.some((word) => value.includes(word))) return rule.intent;
  }
  return value.trim() ? 'general' : 'event';
}

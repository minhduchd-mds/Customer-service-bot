const TEMPLATES = {
  sales: {
    name: 'Sales Assistant',
    category: 'Sales',
    description: 'Tư vấn nhu cầu, báo giá, chốt lead và chuyển sale khi cần.',
    rules: [
      { intent: 'pricing', useAi: true, instruction: 'Answer pricing only from bot/product knowledge. If current price is missing, say it is not available in business data. Never invent a price.' },
      { intent: 'sales', response: 'Mình có thể hỗ trợ chọn sản phẩm phù hợp. Anh/chị cho mình biết nhu cầu, số lượng và khu vực nhận hàng nhé.' },
      { intent: 'promotion', useAi: true, instruction: 'Answer promotion questions only from current business knowledge. Never invent discounts, vouchers or expiry dates.' },
      { intent: 'handoff', response: 'Mình đã ghi nhận yêu cầu gặp tư vấn viên và sẽ chuyển toàn bộ nội dung hiện tại sang nhân viên phụ trách.', handoff: true }
    ]
  },
  'product-introduction': {
    name: 'Product Introduction',
    category: 'Product',
    description: 'Giới thiệu sản phẩm theo cấu trúc: giá trị → tính năng → lợi ích → đối tượng phù hợp → CTA.',
    rules: [
      {
        intent: 'product-intro',
        useAi: true,
        instruction: 'Introduce the requested product using only bot/product knowledge. Structure the answer naturally: what it is, customer problem/value, highlights, practical benefits, who it fits, verified price if present, then a concise CTA. Do not invent specifications, stock, warranty, price or promotions.'
      },
      { intent: 'pricing', useAi: true, instruction: 'Return the current product price only when it appears in bot/product knowledge. If it is missing, explicitly say the business data has no confirmed current price.' },
      { intent: 'promotion', useAi: true, instruction: 'Describe only verified promotions found in bot/product knowledge. If none are present, say there is no confirmed promotion in the current data.' },
      { intent: 'sales', response: 'Nếu anh/chị thấy sản phẩm phù hợp, mình có thể ghi nhận nhu cầu, số lượng, khu vực và thông tin liên hệ để chuyển cho tư vấn viên.' },
      { intent: 'handoff', response: 'Mình sẽ chuyển cuộc trao đổi cùng sản phẩm đang quan tâm sang tư vấn viên để hỗ trợ tiếp.', handoff: true }
    ]
  },
  'product-advisor': {
    name: 'Product Advisor',
    category: 'Product',
    description: 'Tư vấn chọn và so sánh sản phẩm theo nhu cầu, ngân sách và tiêu chí khách hàng.',
    rules: [
      { intent: 'product-recommendation', useAi: true, instruction: 'Recommend products only from bot/product knowledge. Ask for missing need, budget or priority when necessary. Explain why each recommendation matches the customer need.' },
      { intent: 'product-compare', useAi: true, instruction: 'Compare only products and attributes found in bot/product knowledge. Use clear criteria such as use case, highlights, benefits, price, warranty or other verified fields. Mark missing data instead of guessing.' },
      { intent: 'product-intro', useAi: true, instruction: 'Introduce the product from bot/product knowledge and relate the benefits to the customer need. Avoid a raw specification dump.' },
      { intent: 'pricing', useAi: true, instruction: 'Use only confirmed price data from bot/product knowledge and identify the exact product/variant when possible.' },
      { intent: 'sales', response: 'Nếu đã chọn được sản phẩm, mình có thể chuyển sang bước lấy số lượng, khu vực và thông tin liên hệ để tạo lead.' },
      { intent: 'handoff', response: 'Mình sẽ chuyển nhu cầu và tiêu chí lựa chọn hiện tại sang tư vấn viên để tiếp tục tư vấn.', handoff: true }
    ]
  },
  support: {
    name: 'Customer Support',
    category: 'Support',
    description: 'Tiếp nhận lỗi, hướng dẫn và chuyển nhân viên khi cần.',
    rules: [
      { intent: 'support', response: 'Anh/chị mô tả giúp mình lỗi đang gặp, thiết bị hoặc môi trường sử dụng và mức độ ảnh hưởng để mình kiểm tra theo tài liệu hỗ trợ.' },
      { intent: 'handoff', response: 'Mình sẽ chuyển cuộc hội thoại sang nhân viên hỗ trợ để xử lý tiếp mà không yêu cầu anh/chị lặp lại thông tin.', handoff: true }
    ]
  },
  order: {
    name: 'Order Tracking',
    category: 'Order',
    description: 'Nhận mã đơn và chỉ trả trạng thái từ hệ thống nghiệp vụ thật.',
    rules: [
      { intent: 'order-status', response: 'Anh/chị gửi giúp mình mã đơn hàng. Mình sẽ chuyển mã sang hệ thống nghiệp vụ để lấy trạng thái thật và không tự đoán thông tin giao hàng.' },
      { intent: 'handoff', response: 'Mình đã chuyển yêu cầu kiểm tra đơn hàng sang nhân viên hỗ trợ.', handoff: true }
    ]
  }
};

export function listScenarioTemplates() {
  return Object.entries(TEMPLATES).map(([id, item]) => ({
    id,
    name: item.name,
    category: item.category || 'General',
    description: item.description || '',
    rules: item.rules.map((rule) => ({ ...rule }))
  }));
}

export function scenarioFromTemplate(id) {
  const template = TEMPLATES[id];
  if (!template) return null;
  return { template: id, rules: template.rules.map((rule) => ({ ...rule })), notes: '' };
}

export function resolveScenario(bot, intent) {
  if (!bot || bot.intelligenceMode === 'ai') return null;
  const rules = Array.isArray(bot.scenario?.rules) ? bot.scenario.rules : [];
  const rule = rules.find((item) => item.intent === intent) || rules.find((item) => item.intent === 'general');
  if (!rule) return null;
  return {
    response: rule.response || '',
    handoff: Boolean(rule.handoff),
    useAi: Boolean(rule.useAi),
    instruction: String(rule.instruction || '')
  };
}

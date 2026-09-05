const TEMPLATES = {
  sales: {
    name: 'Sales Assistant',
    rules: [
      { intent: 'pricing', response: 'Anh/chị cho mình tên sản phẩm hoặc gói dịch vụ cần báo giá. Mình sẽ chỉ sử dụng bảng giá đã có trong dữ liệu doanh nghiệp.' },
      { intent: 'sales', response: 'Mình có thể hỗ trợ chọn sản phẩm phù hợp. Anh/chị cho mình biết nhu cầu, số lượng và khu vực nhận hàng nhé.' },
      { intent: 'handoff', response: 'Mình đã ghi nhận yêu cầu gặp tư vấn viên và sẽ chuyển toàn bộ nội dung hiện tại sang nhân viên phụ trách.', handoff: true }
    ]
  },
  support: {
    name: 'Customer Support',
    rules: [
      { intent: 'support', response: 'Anh/chị mô tả giúp mình lỗi đang gặp, thiết bị hoặc môi trường sử dụng và mức độ ảnh hưởng để mình kiểm tra theo tài liệu hỗ trợ.' },
      { intent: 'handoff', response: 'Mình sẽ chuyển cuộc hội thoại sang nhân viên hỗ trợ để xử lý tiếp mà không yêu cầu anh/chị lặp lại thông tin.', handoff: true }
    ]
  },
  order: {
    name: 'Order Tracking',
    rules: [
      { intent: 'order-status', response: 'Anh/chị gửi giúp mình mã đơn hàng. Mình sẽ chuyển mã sang hệ thống nghiệp vụ để lấy trạng thái thật và không tự đoán thông tin giao hàng.' },
      { intent: 'handoff', response: 'Mình đã chuyển yêu cầu kiểm tra đơn hàng sang nhân viên hỗ trợ.', handoff: true }
    ]
  }
};

export function listScenarioTemplates() {
  return Object.entries(TEMPLATES).map(([id, item]) => ({ id, name: item.name, rules: item.rules.map((rule) => ({ ...rule })) }));
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
  return { response: rule.response || '', handoff: Boolean(rule.handoff) };
}

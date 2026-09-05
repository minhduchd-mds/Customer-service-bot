const TEMPLATES = {
  sales: {
    name: 'Sales Assistant',
    category: 'Sales',
    description: 'Tư vấn nhu cầu, báo giá, chốt lead và chuyển sale khi cần.',
    rules: [
      { intent: 'pricing', response: 'Anh/chị cho mình tên sản phẩm hoặc gói dịch vụ cần báo giá. Mình sẽ chỉ sử dụng bảng giá đã có trong dữ liệu doanh nghiệp.' },
      { intent: 'sales', response: 'Mình có thể hỗ trợ chọn sản phẩm phù hợp. Anh/chị cho mình biết nhu cầu, số lượng và khu vực nhận hàng nhé.' },
      { intent: 'promotion', response: 'Mình sẽ kiểm tra chương trình ưu đãi đang có trong dữ liệu doanh nghiệp. Nếu chưa có dữ liệu khuyến mại hiện hành, mình sẽ không tự tạo ưu đãi.' },
      { intent: 'handoff', response: 'Mình đã ghi nhận yêu cầu gặp tư vấn viên và sẽ chuyển toàn bộ nội dung hiện tại sang nhân viên phụ trách.', handoff: true }
    ]
  },
  'product-introduction': {
    name: 'Product Introduction',
    category: 'Product',
    description: 'Giới thiệu sản phẩm theo cấu trúc: giá trị → tính năng → lợi ích → đối tượng phù hợp → CTA.',
    rules: [
      { intent: 'product-intro', response: 'Mình sẽ giới thiệu sản phẩm dựa trên dữ liệu đã được doanh nghiệp cung cấp: sản phẩm giải quyết nhu cầu gì, điểm nổi bật, lợi ích thực tế, đối tượng phù hợp và bước tiếp theo. Anh/chị cho mình tên sản phẩm muốn xem nhé.' },
      { intent: 'pricing', response: 'Mình sẽ lấy giá từ Product Knowledge hoặc bảng giá đã nạp. Nếu dữ liệu chưa có giá hiện hành, mình sẽ báo chưa đủ thông tin thay vì tự suy đoán.' },
      { intent: 'promotion', response: 'Mình sẽ kiểm tra ưu đãi gắn với đúng sản phẩm trong dữ liệu hiện hành. Ưu đãi hết hạn hoặc không có nguồn xác nhận sẽ không được sử dụng.' },
      { intent: 'sales', response: 'Nếu anh/chị thấy sản phẩm phù hợp, mình có thể ghi nhận nhu cầu, số lượng, khu vực và thông tin liên hệ để chuyển cho tư vấn viên.' },
      { intent: 'handoff', response: 'Mình sẽ chuyển cuộc trao đổi cùng sản phẩm đang quan tâm sang tư vấn viên để hỗ trợ tiếp.', handoff: true }
    ]
  },
  'product-advisor': {
    name: 'Product Advisor',
    category: 'Product',
    description: 'Tư vấn chọn và so sánh sản phẩm theo nhu cầu, ngân sách và tiêu chí khách hàng.',
    rules: [
      { intent: 'product-recommendation', response: 'Để gợi ý đúng sản phẩm, anh/chị cho mình 3 thông tin: nhu cầu chính, khoảng ngân sách và tiêu chí ưu tiên. Mình sẽ đối chiếu với Product Knowledge đã nạp.' },
      { intent: 'product-compare', response: 'Anh/chị gửi giúp mình 2 sản phẩm cần so sánh. Mình sẽ so theo các tiêu chí có dữ liệu như tính năng, lợi ích, giá, bảo hành và đối tượng phù hợp; mục nào thiếu dữ liệu sẽ được ghi rõ.' },
      { intent: 'product-intro', response: 'Mình có thể giới thiệu nhanh sản phẩm theo nhu cầu sử dụng thay vì đọc danh sách tính năng. Anh/chị cho mình tên sản phẩm hoặc mục đích sử dụng nhé.' },
      { intent: 'pricing', response: 'Mình chỉ dùng mức giá đã có trong dữ liệu doanh nghiệp. Nếu anh/chị cho mình sản phẩm cụ thể, mình sẽ kiểm tra đúng phiên bản và mức giá tương ứng.' },
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
  return { response: rule.response || '', handoff: Boolean(rule.handoff) };
}

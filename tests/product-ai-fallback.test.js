import test from 'node:test';
import assert from 'node:assert/strict';
import { AiRouter } from '../src/core/ai-router.js';

test('product introduction fallback uses bot product knowledge when AI provider is disabled', async () => {
  const ai = new AiRouter({ baseUrl: '', apiKey: '', model: '', timeoutMs: 1000, systemPrompt: 'test' });
  const reply = await ai.reply({
    intent: 'product-intro',
    event: { channel: 'telegram', text: 'Giới thiệu sản phẩm' },
    skill: { id: 'sales-assistant', description: 'sales' },
    knowledge: [],
    botKnowledge: [{
      type: 'text',
      name: 'Product · Kingmart A1',
      value: [
        'PRODUCT: Kingmart A1',
        'INTRODUCTION: Thiết bị hỗ trợ quản lý cửa hàng.',
        'HIGHLIGHTS_AND_BENEFITS: Thiết lập nhanh; theo dõi tập trung.',
        'CURRENT_PRICE: 8.990.000đ',
        'CTA: Để lại SĐT để được tư vấn.'
      ].join('\n')
    }]
  });

  assert.match(reply, /Kingmart A1/);
  assert.match(reply, /8\.990\.000đ/);
  assert.match(reply, /Để lại SĐT/);
});

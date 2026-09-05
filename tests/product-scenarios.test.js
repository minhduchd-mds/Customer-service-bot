import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent } from '../src/core/intent.js';
import { listScenarioTemplates, resolveScenario, scenarioFromTemplate } from '../src/core/scenario.js';

test('product discovery intents are classified before generic sales', () => {
  assert.equal(classifyIntent('Giới thiệu sản phẩm này cho tôi'), 'product-intro');
  assert.equal(classifyIntent('So sánh mẫu A và mẫu B'), 'product-compare');
  assert.equal(classifyIntent('Gợi ý sản phẩm phù hợp nhu cầu của tôi'), 'product-recommendation');
  assert.equal(classifyIntent('Sản phẩm đang có khuyến mại gì?'), 'promotion');
});

test('product templates are discoverable and carry ready rules', () => {
  const templates = listScenarioTemplates();
  const intro = templates.find((item) => item.id === 'product-introduction');
  const advisor = templates.find((item) => item.id === 'product-advisor');
  assert.equal(intro?.category, 'Product');
  assert.ok(intro?.rules.length >= 4);
  assert.equal(advisor?.category, 'Product');
  assert.ok(advisor?.rules.some((rule) => rule.intent === 'product-compare'));
});

test('product scenario resolves deterministic introduction response', () => {
  const scenario = scenarioFromTemplate('product-introduction');
  const bot = { intelligenceMode: 'hybrid', scenario };
  const result = resolveScenario(bot, 'product-intro');
  assert.match(result.response, /giới thiệu sản phẩm/i);
  assert.equal(result.handoff, false);
});

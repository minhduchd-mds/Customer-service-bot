import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWebConsoleCors, isWidgetPublicPath } from '../src/core/web-console-cors.js';

function responseStub() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    writeHead(status, values = {}) { this.statusCode = status; for (const [key, value] of Object.entries(values)) headers.set(key.toLowerCase(), value); },
    end(value = '') { this.body = String(value); },
    headers
  };
}

test('widget public surfaces bypass management-console CORS policy', () => {
  assert.equal(isWidgetPublicPath('/widget.js'), true);
  assert.equal(isWidgetPublicPath('/widget.html'), true);
  assert.equal(isWidgetPublicPath('/api/widget/bot/message'), true);
  assert.equal(isWidgetPublicPath('/api/bots'), false);

  const response = responseStub();
  const result = applyWebConsoleCors({ url: '/api/widget/bot/message', method: 'POST', headers: { origin: 'https://shop.example' } }, response, { origins: ['https://console.example'] });
  assert.equal(result.handled, false);
  assert.equal(result.skipped, 'widget');
  assert.equal(response.statusCode, 0);
});

test('management CORS denies an unapproved cross-origin console request', () => {
  const response = responseStub();
  const result = applyWebConsoleCors({ url: '/api/bots', method: 'GET', headers: { origin: 'https://evil.example', host: 'bot.example' } }, response, { origins: ['https://console.example'] });
  assert.equal(result.handled, true);
  assert.equal(result.allowed, false);
  assert.equal(response.statusCode, 403);
});

test('management CORS allows configured console origin and handles preflight', () => {
  const response = responseStub();
  const result = applyWebConsoleCors({ url: '/api/bots', method: 'OPTIONS', headers: { origin: 'https://console.example', host: 'bot.example' } }, response, { origins: ['https://console.example'] });
  assert.equal(result.handled, true);
  assert.equal(result.allowed, true);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://console.example');
});

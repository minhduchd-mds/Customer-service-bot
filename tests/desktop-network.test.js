import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQrBaseUrl, selectLanAddress } from '../desktop/network.js';

const interfaces = {
  'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.28.64.1' }],
  'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.25' }],
  Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }]
};

test('desktop QR prefers a physical LAN adapter over virtual adapters', () => {
  assert.equal(selectLanAddress(interfaces), '192.168.1.25');
});

test('desktop QR uses configured public HTTPS URL when present', () => {
  assert.deepEqual(
    buildQrBaseUrl({ publicBaseUrl: 'https://bot.example.com/', port: 49152, interfaces }),
    { baseUrl: 'https://bot.example.com', source: 'public' }
  );
});

test('desktop QR builds a phone-reachable LAN URL instead of localhost', () => {
  assert.deepEqual(
    buildQrBaseUrl({ port: 49152, interfaces }),
    { baseUrl: 'http://192.168.1.25:49152', source: 'lan', address: '192.168.1.25' }
  );
});

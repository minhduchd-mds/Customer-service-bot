import { networkInterfaces as readNetworkInterfaces } from 'node:os';

const VIRTUAL_HINTS = /(vethernet|virtual|wsl|hyper-v|vmware|virtualbox|docker|loopback|npcap|bluetooth)/i;
const PHYSICAL_HINTS = /(wi-?fi|wlan|wireless|ethernet|local area connection)/i;

export function selectLanAddress(interfaces = readNetworkInterfaces()) {
  const candidates = [];

  for (const [name, entries] of Object.entries(interfaces || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue;
      const address = String(entry.address || '');
      if (!isUsableIpv4(address)) continue;

      let score = 0;
      if (PHYSICAL_HINTS.test(name)) score += 100;
      if (VIRTUAL_HINTS.test(name)) score -= 120;
      if (address.startsWith('192.168.')) score += 40;
      else if (address.startsWith('10.')) score += 30;
      else if (isPrivate172(address)) score += 20;
      else score += 5;

      candidates.push({ address, name, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return candidates[0]?.address || null;
}

export function buildQrBaseUrl({ publicBaseUrl = '', port, interfaces } = {}) {
  const configured = String(publicBaseUrl || '').trim().replace(/\/$/, '');
  if (configured) return { baseUrl: configured, source: 'public' };

  const address = selectLanAddress(interfaces);
  if (!address || !Number.isInteger(Number(port)) || Number(port) <= 0) {
    return { baseUrl: null, source: 'unavailable' };
  }

  return { baseUrl: `http://${address}:${Number(port)}`, source: 'lan', address };
}

function isUsableIpv4(address) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return false;
  if (octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254)) return false;
  return true;
}

function isPrivate172(address) {
  const octets = address.split('.').map(Number);
  return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
}

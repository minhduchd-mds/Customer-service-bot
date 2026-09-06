const VERSION = 5;
const SIZE = 17 + 4 * VERSION;
const DATA_CODEWORDS = 108;
const EC_CODEWORDS = 26;
const MAX_BYTES = 106;

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 0; i < 8; i++) {
    if (y & 1) z ^= x;
    y >>>= 1;
    const carry = x & 0x80;
    x = (x << 1) & 0xff;
    if (carry) x ^= 0x1d;
  }
  return z;
}

function generatorPolynomial(degree) {
  let generator = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = new Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j++) {
      next[j] ^= generator[j];
      next[j + 1] ^= gfMultiply(generator[j], root);
    }
    generator = next;
    root = gfMultiply(root, 2);
  }
  return generator;
}

function appendBits(target, value, length) {
  for (let i = length - 1; i >= 0; i--) target.push((value >>> i) & 1);
}

function encodeData(value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > MAX_BYTES) throw new Error(`qr_payload_too_long:${bytes.length}`);
  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  const capacityBits = DATA_CODEWORDS * 8;
  for (let i = 0; i < Math.min(4, capacityBits - bits.length); i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value8 = 0;
    for (const bit of bits.slice(i, i + 8)) value8 = (value8 << 1) | bit;
    codewords.push(value8);
  }
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < DATA_CODEWORDS) codewords.push(pads[padIndex++ % pads.length]);
  return codewords;
}

function errorCorrection(data) {
  const generator = generatorPolynomial(EC_CODEWORDS);
  const working = [...data, ...new Array(EC_CODEWORDS).fill(0)];
  for (let i = 0; i < DATA_CODEWORDS; i++) {
    const factor = working[i];
    if (!factor) continue;
    for (let j = 0; j < generator.length; j++) working[i + j] ^= gfMultiply(generator[j], factor);
  }
  return working.slice(DATA_CODEWORDS);
}

function formatBits(mask = 0) {
  const data = (0b01 << 3) | mask; // Error correction level L.
  let remainder = data << 10;
  const generator = 0x537;
  const bitLength = (value) => value ? 32 - Math.clz32(value) : 0;
  while (bitLength(remainder) >= bitLength(generator)) remainder ^= generator << (bitLength(remainder) - bitLength(generator));
  return ((data << 10) | remainder) ^ 0x5412;
}

export function qrMatrix(value) {
  const data = encodeData(String(value));
  const ecc = errorCorrection(data);
  const bits = [];
  for (const codeword of [...data, ...ecc]) appendBits(bits, codeword, 8);
  bits.push(0, 0, 0, 0, 0, 0, 0); // Version 5 remainder bits.

  const matrix = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const functionModules = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const setFunction = (x, y, value) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    matrix[y][x] = Boolean(value);
    functionModules[y][x] = true;
  };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  };
  finder(3, 3);
  finder(SIZE - 4, 3);
  finder(3, SIZE - 4);

  for (let i = 8; i < SIZE - 8; i++) {
    setFunction(i, 6, i % 2 === 0);
    setFunction(6, i, i % 2 === 0);
  }

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) setFunction(30 + dx, 30 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  const formatA = [];
  for (let i = 0; i <= 5; i++) formatA.push([8, i]);
  formatA.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i <= 14; i++) formatA.push([14 - i, 8]);
  const formatB = [];
  for (let i = 0; i <= 7; i++) formatB.push([SIZE - 1 - i, 8]);
  for (let i = 8; i <= 14; i++) formatB.push([8, SIZE - 15 + i]);
  for (const [x, y] of [...formatA, ...formatB]) setFunction(x, y, false);
  setFunction(8, SIZE - 8, true);

  let bitIndex = 0;
  let upward = true;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let vertical = 0; vertical < SIZE; vertical++) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (functionModules[y][x]) continue;
        let bit = bits[bitIndex++] || 0;
        if ((x + y) % 2 === 0) bit ^= 1; // Mask 0.
        matrix[y][x] = Boolean(bit);
      }
    }
    upward = !upward;
  }

  const format = formatBits(0);
  formatA.forEach(([x, y], index) => setFunction(x, y, Boolean((format >>> index) & 1)));
  formatB.forEach(([x, y], index) => setFunction(x, y, Boolean((format >>> index) & 1)));
  setFunction(8, SIZE - 8, true);
  return matrix;
}

export function qrSvg(value, { scale = 6, quiet = 4 } = {}) {
  const matrix = qrMatrix(value);
  const dimension = matrix.length + quiet * 2;
  const modules = [];
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) {
      if (matrix[y][x]) modules.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" width="${dimension * scale}" height="${dimension * scale}" shape-rendering="crispEdges" role="img" aria-label="Connection QR code"><rect width="100%" height="100%" fill="white"/><g fill="#111111">${modules.join('')}</g></svg>`;
}

/**
 * Zero-Dependency ISO/IEC 18004 Spec-Compliant QR Code Generator
 * Supports Versions 1 to 10 (Byte mode, ECC Level M / L), complete Reed-Solomon ECC,
 * block interleaving, alignment patterns, and optimal mask evaluation (N1-N4 penalties).
 */

// GF(256) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d = 285)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// Computes Reed-Solomon generator polynomial for a given degree
function getGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

// Computes Reed-Solomon error correction codewords for a data block
function rsCompute(data, degree) {
  const poly = getGeneratorPoly(degree);
  const rem = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    for (let j = 0; j < degree - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(factor, poly[j + 1]);
    }
    rem[degree - 1] = gfMul(factor, poly[degree]);
  }
  return rem;
}

// ISO 18004 Table 7 (Version specifications for ECC Level M)
// [version, totalCodewords, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data, remainderBits]
const VERSION_TABLE_M = [
  null,
  [1, 26, 10, 1, 16, 0, 0, 0],
  [2, 44, 16, 1, 28, 0, 0, 7],
  [3, 70, 26, 1, 44, 0, 0, 7],
  [4, 100, 18, 2, 32, 0, 0, 7],
  [5, 134, 24, 2, 43, 0, 0, 7],
  [6, 172, 16, 4, 27, 0, 0, 7],
  [7, 196, 18, 4, 31, 0, 0, 0],
  [8, 242, 22, 2, 38, 2, 39, 0],
  [9, 292, 22, 3, 36, 2, 37, 0],
  [10, 346, 26, 4, 43, 1, 44, 0],
];

// ISO 18004 Table 7 (Version specifications for ECC Level L)
const VERSION_TABLE_L = [
  null,
  [1, 26, 7, 1, 19, 0, 0, 0],
  [2, 44, 10, 1, 34, 0, 0, 7],
  [3, 70, 15, 1, 55, 0, 0, 7],
  [4, 100, 20, 1, 80, 0, 0, 7],
  [5, 134, 26, 1, 108, 0, 0, 7],
  [6, 172, 18, 2, 68, 0, 0, 7],
  [7, 196, 20, 2, 78, 0, 0, 0],
  [8, 242, 24, 2, 97, 0, 0, 0],
  [9, 292, 30, 2, 116, 0, 0, 0],
  [10, 346, 18, 2, 68, 2, 69, 0],
];

// ISO Table E.1: Alignment pattern coordinates for versions 1 to 10
const ALIGNMENT_COORDS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// BCH(18,6) Version info constants for versions 7 to 10
const VERSION_INFO = [
  null, null, null, null, null, null, null,
  0x07c94, // V7
  0x085bc, // V8
  0x09a99, // V9
  0x0a4d3, // V10
];

/**
 * Automatically chooses the minimal QR Version that can accommodate byteCount
 */
function selectVersion(byteCount, level = 'M') {
  const table = level === 'L' ? VERSION_TABLE_L : VERSION_TABLE_M;
  for (let v = 1; v <= 10; v++) {
    const row = table[v];
    const totalDataCodewords = row[3] * row[4] + row[5] * row[6];
    // Byte mode overhead: 4 bits mode + (v >= 10 ? 16 : 8) bits count
    const overheadBits = 4 + (v >= 10 ? 16 : 8);
    const capacityBytes = Math.floor((totalDataCodewords * 8 - overheadBits) / 8);
    if (byteCount <= capacityBytes) {
      return { version: v, config: row, level };
    }
  }
  throw new Error(`Data too large for QR Versions 1-10 (${byteCount} bytes)`);
}

/**
 * Builds interleaved data and error correction codewords
 */
function encodeData(bytes, vInfo) {
  const { version, config } = vInfo;
  const [, totalCodewords, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data, remBits] = config;
  const totalDataCodewords = g1Blocks * g1Data + g2Blocks * g2Data;

  // 1. Bitstream assembly
  const bits = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // Byte mode indicator: 0100
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for V1-V9, 16 bits for V10)
  pushBits(bytes.length, version >= 10 ? 16 : 8);
  // Data bytes
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bytes[i], 8);
  }
  // Terminator: up to 4 zeroes
  const termLen = Math.min(4, totalDataCodewords * 8 - bits.length);
  pushBits(0, termLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Convert bitstream to data codewords
  const dataCodewords = new Uint8Array(totalDataCodewords);
  let byteIdx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i + j];
    }
    dataCodewords[byteIdx++] = b;
  }

  // Pad with alternating 0xEC and 0x11
  let pad = 0xec;
  while (byteIdx < totalDataCodewords) {
    dataCodewords[byteIdx++] = pad;
    pad = pad === 0xec ? 0x11 : 0xec;
  }

  // 2. Divide data codewords into blocks and compute EC per block
  const totalBlocks = g1Blocks + g2Blocks;
  const dataBlocks = [];
  const ecBlocks = [];

  let dataOffset = 0;
  for (let b = 0; b < totalBlocks; b++) {
    const blockSize = b < g1Blocks ? g1Data : g2Data;
    const blockData = dataCodewords.subarray(dataOffset, dataOffset + blockSize);
    dataBlocks.push(blockData);
    ecBlocks.push(rsCompute(blockData, ecPerBlock));
    dataOffset += blockSize;
  }

  // 3. Interleave data codewords across all blocks
  const result = [];
  const maxDataLen = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      if (i < dataBlocks[b].length) {
        result.push(dataBlocks[b][i]);
      }
    }
  }

  // 4. Interleave EC codewords across all blocks
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      result.push(ecBlocks[b][i]);
    }
  }

  return {
    codewords: new Uint8Array(result),
    remBits,
  };
}

/**
 * Initializes QR Matrix and marks reserved function patterns
 */
function createMatrix(version) {
  const N = 17 + 4 * version;
  const matrix = Array.from({ length: N }, () => new Array(N).fill(null));
  const reserved = Array.from({ length: N }, () => new Array(N).fill(false));

  function setFinder(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        reserved[nr][nc] = true;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBlack =
            r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          matrix[nr][nc] = isBlack ? 1 : 0;
        } else {
          matrix[nr][nc] = 0; // Separator
        }
      }
    }
  }

  // Finders
  setFinder(0, 0);
  setFinder(0, N - 7);
  setFinder(N - 7, 0);

  // Timing patterns
  for (let i = 8; i < N - 8; i++) {
    if (!reserved[6][i]) {
      reserved[6][i] = true;
      matrix[6][i] = i % 2 === 0 ? 1 : 0;
    }
    if (!reserved[i][6]) {
      reserved[i][6] = true;
      matrix[i][6] = i % 2 === 0 ? 1 : 0;
    }
  }

  // Alignment patterns
  const coords = ALIGNMENT_COORDS[version] || [];
  for (let r = 0; r < coords.length; r++) {
    for (let c = 0; c < coords.length; c++) {
      const cr = coords[r];
      const cc = coords[c];
      // Skip if overlaps finder
      if (reserved[cr][cc]) continue;

      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          reserved[cr + dr][cc + dc] = true;
          const isBlack = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          matrix[cr + dr][cc + dc] = isBlack ? 1 : 0;
        }
      }
    }
  }

  // Dark module: (4*V + 9, 8)
  const darkRow = 4 * version + 9;
  matrix[darkRow][8] = 1;
  reserved[darkRow][8] = true;

  // Format information areas (reserved)
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][N - 1 - i] = true;
    reserved[N - 1 - i][8] = true;
  }

  // Version info areas for V >= 7
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[N - 11 + j][i] = true;
        reserved[i][N - 11 + j] = true;
      }
    }
  }

  return { matrix, reserved, N };
}

/**
 * Places interleaved codewords into the matrix in standard zigzag order
 */
function placeCodewords(matrix, reserved, N, codewords, remBits) {
  let bitIdx = 0;
  const totalBits = codewords.length * 8 + remBits;
  let dir = -1; // Moving upwards
  let col = N - 1;
  let row = N - 1;

  while (col > 0) {
    if (col === 6) col--; // Skip vertical timing pattern
    while (row >= 0 && row < N) {
      for (let c = 0; c < 2; c++) {
        const currCol = col - c;
        if (!reserved[row][currCol]) {
          let bit = 0;
          if (bitIdx < totalBits) {
            const byte = codewords[Math.floor(bitIdx / 8)];
            bit = (byte >> (7 - (bitIdx % 8))) & 1;
            bitIdx++;
          }
          matrix[row][currCol] = bit;
        }
      }
      row += dir;
    }
    dir = -dir;
    row += dir;
    col -= 2;
  }
}

/**
 * 8 Standard ISO Mask Formulas
 */
function isMasked(pattern, r, c) {
  switch (pattern) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

/**
 * Computes 15-bit format code with BCH(15,5) and 0x5412 mask
 * Level M: 00, Level L: 01, Level H: 10, Level Q: 11
 */
function getFormatBits(level, maskPattern) {
  const eccBits = level === 'L' ? 0b01 : level === 'H' ? 0b10 : level === 'Q' ? 0b11 : 0b00;
  const data = (eccBits << 3) | maskPattern;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) {
      rem ^= (0x537 << (i - 10));
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * Inscribes format bits into the matrix around finders
 */
function applyFormatBits(matrix, N, formatBits) {
  // Top-left finder format bits
  // Format bits 0..14: bit 14 is MSB, bit 0 is LSB
  for (let i = 0; i < 6; i++) {
    matrix[8][i] = (formatBits >> (14 - i)) & 1;
  }
  matrix[8][7] = (formatBits >> 8) & 1;
  matrix[8][8] = (formatBits >> 7) & 1;
  matrix[7][8] = (formatBits >> 6) & 1;
  for (let i = 9; i < 15; i++) {
    matrix[14 - i][8] = (formatBits >> (14 - i)) & 1;
  }

  // Bottom-left and Top-right finder format bits
  for (let i = 0; i < 7; i++) {
    matrix[N - 1 - i][8] = (formatBits >> (14 - i)) & 1;
  }
  for (let i = 7; i < 15; i++) {
    matrix[8][N - 15 + i] = (formatBits >> (14 - i)) & 1;
  }
}

/**
 * Inscribes version bits for V >= 7 into matrix
 */
function applyVersionBits(matrix, N, version) {
  if (version < 7) return;
  const info = VERSION_INFO[version];
  let bit = 0;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 3; j++) {
      const val = (info >> bit) & 1;
      bit++;
      matrix[N - 11 + j][i] = val;
      matrix[i][N - 11 + j] = val;
    }
  }
}

/**
 * ISO 18004 Section 8.8.2: Penalty scoring N1, N2, N3, N4
 */
function evaluatePenalty(matrix, N) {
  let score = 0;

  // N1: 5+ consecutive modules of same color
  for (let r = 0; r < N; r++) {
    let runColor = matrix[r][0];
    let runLen = 1;
    for (let c = 1; c < N; c++) {
      if (matrix[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = matrix[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }

  for (let c = 0; c < N; c++) {
    let runColor = matrix[0][c];
    let runLen = 1;
    for (let r = 1; r < N; r++) {
      if (matrix[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = matrix[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }

  // N2: 2x2 blocks of same color
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const color = matrix[r][c];
      if (
        color === matrix[r + 1][c] &&
        color === matrix[r][c + 1] &&
        color === matrix[r + 1][c + 1]
      ) {
        score += 3;
      }
    }
  }

  // N3: 1:1:3:1:1 patterns (00001011101 or 10111010000)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N - 10; c++) {
      const s = matrix[r].slice(c, c + 11);
      // Pattern A: 0 0 0 0 1 0 1 1 1 0 1
      if (
        s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0 &&
        s[4] === 1 && s[5] === 0 && s[6] === 1 && s[7] === 1 && s[8] === 1 && s[9] === 0 && s[10] === 1
      ) {
        score += 40;
      }
      // Pattern B: 1 0 1 1 1 0 1 0 0 0 0
      if (
        s[0] === 1 && s[1] === 0 && s[2] === 1 && s[3] === 1 && s[4] === 1 && s[5] === 0 &&
        s[6] === 1 && s[7] === 0 && s[8] === 0 && s[9] === 0 && s[10] === 0
      ) {
        score += 40;
      }
    }
  }

  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N - 10; r++) {
      // Column slice
      const s = [];
      for (let k = 0; k < 11; k++) s.push(matrix[r + k][c]);
      if (
        s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0 &&
        s[4] === 1 && s[5] === 0 && s[6] === 1 && s[7] === 1 && s[8] === 1 && s[9] === 0 && s[10] === 1
      ) {
        score += 40;
      }
      if (
        s[0] === 1 && s[1] === 0 && s[2] === 1 && s[3] === 1 && s[4] === 1 && s[5] === 0 &&
        s[6] === 1 && s[7] === 0 && s[8] === 0 && s[9] === 0 && s[10] === 0
      ) {
        score += 40;
      }
    }
  }

  // N4: Ratio of dark to light modules
  let darkCount = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix[r][c] === 1) darkCount++;
    }
  }
  const pct = (darkCount / (N * N)) * 100;
  const k = Math.floor(Math.abs(pct - 50) / 5);
  score += k * 10;

  return score;
}

/**
 * Generates ISO/IEC 18004 Compliant QR Code Matrix (0 = light, 1 = dark)
 */
export function generateQrMatrix(text, options = {}) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const eccLevel = options.level || 'M';
  const vInfo = selectVersion(bytes.length, eccLevel);
  const { codewords, remBits } = encodeData(bytes, vInfo);

  const { matrix: baseMatrix, reserved, N } = createMatrix(vInfo.version);
  placeCodewords(baseMatrix, reserved, N, codewords, remBits);

  // Evaluate all 8 mask patterns to select the lowest penalty score
  let bestMask = 0;
  let lowestPenalty = Infinity;
  let bestMatrix = null;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseMatrix.map((row) => row.slice());
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!reserved[r][c]) {
          candidate[r][c] = candidate[r][c] ^ (isMasked(mask, r, c) ? 1 : 0);
        }
      }
    }

    const fmt = getFormatBits(eccLevel, mask);
    applyFormatBits(candidate, N, fmt);
    applyVersionBits(candidate, N, vInfo.version);

    const penalty = evaluatePenalty(candidate, N);
    if (penalty < lowestPenalty) {
      lowestPenalty = penalty;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  return bestMatrix;
}

/**
 * Generates a clean, crisp SVG string from QR matrix
 */
export function generateQrSvg(text, pixelSize = 200, margin = 2) {
  try {
    const matrix = generateQrMatrix(text);
    const N = matrix.length;
    const totalSize = N + margin * 2;

    let pathD = '';
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (matrix[r][c] === 1) {
          const x = c + margin;
          const y = r + margin;
          pathD += `M${x},${y}h1v1h-1z `;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges">
  <rect width="${totalSize}" height="${totalSize}" fill="#ffffff"/>
  <path d="${pathD}" fill="#000000"/>
</svg>`;
  } catch (err) {
    return `<div style="color: red; font-size: 11px;">QR Generation Failed: ${err.message}</div>`;
  }
}

import fs from 'node:fs';
import zlib from 'node:zlib';

function makeTransparentIcon(srcPath, destPath) {
  const buf = fs.readFileSync(srcPath);

  // Read IHDR
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];

  if (colorType !== 6 || bitDepth !== 8) {
    throw new Error(`Unsupported PNG format: colorType=${colorType}, bitDepth=${bitDepth}`);
  }

  // Collect IDATs and identify chunk layout
  const idatChunks = [];
  let p = 8;
  let ihdrChunk = null;

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.slice(p + 4, p + 8).toString('ascii');
    const chunkData = buf.slice(p + 8, p + 8 + len);

    if (type === 'IHDR') {
      ihdrChunk = buf.slice(p, p + 12 + len);
    } else if (type === 'IDAT') {
      idatChunks.push(chunkData);
    }
    p += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const rowSize = 1 + width * 4;

  // Process pixels to make dark background transparent
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    // scanline filter byte is at rowOffset
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 4;
      const r = raw[px];
      const g = raw[px + 1];
      const b = raw[px + 2];

      // Dark background is #0b1120 (R~11, G~17, B~32)
      // Light mark is #e4e4e7 (R~228, G~228, B~231)
      const lum = (r * 299 + g * 587 + b * 114) / 1000;

      if (lum < 35) {
        // Pure background -> 100% transparent
        raw[px + 3] = 0;
      } else if (lum < 160) {
        // Antialiased edge -> smooth alpha transition
        const alphaFraction = (lum - 35) / (160 - 35);
        raw[px + 3] = Math.round(alphaFraction * 255);
      } else {
        // Mark interior -> full opacity
        raw[px + 3] = 255;
      }
    }
  }

  const newIdatData = zlib.deflateSync(raw);

  // Compute CRC32
  function crc32(buffer) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    let crc = 0 ^ (-1);
    for (let i = 0; i < buffer.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
    }
    return (crc ^ (-1)) >>> 0;
  }

  function makeChunk(typeStr, dataBuf) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(dataBuf.length, 0);
    const type = Buffer.from(typeStr, 'ascii');
    const toCrc = Buffer.concat([type, dataBuf]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(toCrc), 0);
    return Buffer.concat([len, type, dataBuf, crc]);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idatChunk = makeChunk('IDAT', newIdatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  const outBuf = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  fs.writeFileSync(destPath, outBuf);
  console.log(`Saved transparent icon: ${destPath} (${outBuf.length} bytes)`);
}

makeTransparentIcon('public/brand/apple-touch-icon.png', 'public/brand/apple-touch-icon.png');
if (fs.existsSync('public/apple-touch-icon.png')) {
  makeTransparentIcon('public/brand/apple-touch-icon.png', 'public/apple-touch-icon.png');
}

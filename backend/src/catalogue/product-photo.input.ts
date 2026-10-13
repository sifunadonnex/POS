import { BadRequestException } from '@nestjs/common';

export function photoInput(
  value: unknown,
): { content: Buffer; mimeType: string } | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    !('data' in value) ||
    typeof value.data !== 'string' ||
    value.data.length > 699052 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.data,
    )
  )
    throw new BadRequestException(
      'Choose a PNG, JPEG or WebP photo up to 512 KB',
    );
  const content = Buffer.from(value.data, 'base64');
  let mimeType = '',
    width = 0,
    height = 0;
  if (
    content.length >= 45 &&
    content
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    content.readUInt32BE(8) === 13 &&
    content.toString('ascii', 12, 16) === 'IHDR' &&
    content.toString('ascii', content.length - 8, content.length - 4) === 'IEND'
  ) {
    mimeType = 'image/png';
    width = content.readUInt32BE(16);
    height = content.readUInt32BE(20);
  } else if (
    content.length > 12 &&
    content.readUInt16BE(0) === 0xffd8 &&
    content.readUInt16BE(content.length - 2) === 0xffd9
  ) {
    mimeType = 'image/jpeg';
    let offset = 2;
    while (offset + 4 <= content.length && content[offset] === 0xff) {
      const marker = content[offset + 1];
      const length = content.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > content.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      ) {
        height = content.readUInt16BE(offset + 5);
        width = content.readUInt16BE(offset + 7);
        break;
      }
      offset += length + 2;
    }
  } else if (
    content.length >= 30 &&
    content.toString('ascii', 0, 4) === 'RIFF' &&
    content.toString('ascii', 8, 12) === 'WEBP' &&
    content.readUInt32LE(4) === content.length - 8
  ) {
    mimeType = 'image/webp';
    const kind = content.toString('ascii', 12, 16);
    if (kind === 'VP8X' && !(content[20] & 2)) {
      width = content.readUIntLE(24, 3) + 1;
      height = content.readUIntLE(27, 3) + 1;
    } else if (kind === 'VP8L' && content[20] === 0x2f) {
      const bits = content.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (
      kind === 'VP8 ' &&
      content.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
    ) {
      width = content.readUInt16LE(26) & 0x3fff;
      height = content.readUInt16LE(28) & 0x3fff;
    }
  }
  if (
    !mimeType ||
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    content.length > 524288
  )
    throw new BadRequestException(
      'Use a valid static PNG, JPEG or WebP photo up to 512 KB and 4096 × 4096 pixels',
    );
  return { content, mimeType };
}

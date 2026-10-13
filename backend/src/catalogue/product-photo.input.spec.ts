import { photoInput } from './product-photo.input.js';

const data =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
it('accepts an optional raster photo and derives its type from bytes', () => {
  expect(photoInput(null)).toBeNull();
  expect(photoInput({ data })?.mimeType).toBe('image/png');
  const webp =
    'UklGRkIAAABXRUJQVlA4IDYAAADQAgCdASoRAAkAPm0skUWkIqGYBABABsSgB2AAEDYAAP7wOEP//EOdDnQ5mM//8Buvi2XwAAA=';
  expect(photoInput({ data: webp })?.mimeType).toBe('image/webp');
});
it('rejects SVG, malformed base64, oversized bytes and oversized dimensions', () => {
  for (const value of [
    undefined,
    {},
    { data: 'not base64!' },
    { data: Buffer.from('<svg/>').toString('base64') },
    { data: Buffer.alloc(524289).toString('base64') },
  ])
    expect(() => photoInput(value)).toThrow();
  const huge = Buffer.from(data, 'base64');
  huge.writeUInt32BE(50000, 16);
  expect(() => photoInput({ data: huge.toString('base64') })).toThrow('4096');
});

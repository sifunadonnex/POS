import {
  commandInput,
  pageInput,
  priceInput,
  productInput,
} from './catalogue.input.js';
import { parseCatalogueCsv } from './catalogue-csv.js';

const product = {
  sku: 'rice-kg',
  name: 'Loose rice',
  categoryId: null,
  unit: 'kg',
  price: '180.05',
  barcodes: ['0012345678905'],
  active: true,
  taxCode: null,
};
const header = 'sku,name,category,unit,price,barcodes,tax_code\r\n';

it.each([
  ['0', '0'],
  ['0.01', '1'],
  ['180.05', '18005'],
  ['9999999.99', '999999999'],
])('parses exact KES price %s', (value, minor) => {
  expect(priceInput(value)).toBe(minor);
});
it.each([
  '1e3',
  '-1',
  'NaN',
  'Infinity',
  '0.001',
  '10,000',
  '10000000',
  '01.20',
  0.1,
])('rejects ambiguous or out-of-range price %s', (value) => {
  expect(() => priceInput(value)).toThrow();
});
it.each(['each', 'pack', 'kg', 'l'])(
  'accepts sales unit %s while retaining barcode zeros',
  (unit) => {
    expect(productInput({ ...product, unit })).toMatchObject({
      unit,
      sku: 'RICE-KG',
      priceMinor: '18005',
      barcodes: ['0012345678905'],
    });
  },
);
it('rejects invalid units, repeated barcodes and invalid quantities disguised as status', () => {
  expect(() => productInput({ ...product, unit: 'tonne' })).toThrow();
  expect(() => productInput({ ...product, barcodes: ['00', '00'] })).toThrow(
    'Duplicate',
  );
  expect(() => productInput({ ...product, active: 'true' })).toThrow('status');
});
it('requires a replay ID and reason and bounds paged queries', () => {
  expect(() => commandInput({ reason: 'Initial catalogue' })).toThrow(
    'request ID',
  );
  expect(() =>
    commandInput({
      reason: 'x',
      requestId: '7835ae0b-ed56-489d-a8cd-c05b5e35897f',
    }),
  ).toThrow('Reason');
  expect(() => pageInput('2e3')).toThrow();
  expect(() => pageInput(['1'])).toThrow();
  expect(pageInput('2000')).toBe(2000);
});
it('reads UTF-8 BOM, quoted commas and escaped quotes, retaining barcode text', () => {
  const rows = parseCatalogueCsv(
    '\uFEFF' +
      header +
      'RICE,"Rice, ""premium""",,kg,180.05,0012345|0000002,\r\n',
  );
  expect(rows[0].errors).toEqual([]);
  expect(rows[0].input).toMatchObject({
    name: 'Rice, "premium"',
    priceMinor: '18005',
    barcodes: ['0000002', '0012345'],
  });
});
it('reports duplicate SKUs/barcodes and invalid prices per row', () => {
  const rows = parseCatalogueCsv(
    header +
      'one,First,,each,10,001,\nONE,Second,,l,1.20,001,\nthree,Third,,pack,1e3,,',
  );
  expect(rows[1].errors).toEqual(
    expect.arrayContaining([
      'Duplicate SKU in this file',
      'Duplicate barcode in this file: 001',
    ]),
  );
  expect(rows[2].errors.join(' ')).toContain('Price');
});
it('rejects broken CSV, unknown columns, empty imports, oversized files and batches', () => {
  for (const value of [
    header + 'x,"unterminated',
    'name,sku\nx,y',
    header,
    'x'.repeat(32769),
    header + 'x,Item,,each,1,,\n'.repeat(101),
  ])
    expect(() => parseCatalogueCsv(value)).toThrow();
});
it('rejects embedded newlines in product fields even when valid CSV quoting permits them', () => {
  expect(
    parseCatalogueCsv(header + 'x,"Line\nbreak",,each,1,,')[0].errors,
  ).toContain('Invalid product name');
});

import { BadRequestException } from '@nestjs/common';
import { productInput, type ProductInput } from './catalogue.input.js';

const headers = [
  'sku',
  'name',
  'category',
  'unit',
  'price',
  'barcodes',
  'tax_code',
];
export type ImportRow = {
  row: number;
  sku: string;
  name: string;
  categoryName: string;
  input: ProductInput | null;
  errors: string[];
};

export function csvText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value, 'utf8') > 32768
  )
    throw new BadRequestException(
      'Choose a nonempty UTF-8 CSV file of at most 32 KB',
    );
  return value.replace(/^\uFEFF/, '');
}

// RFC-style quoted fields, escaped quotes, CRLF/LF and embedded newlines.
// Business validation below still rejects control characters in product fields.
function records(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  function endField() {
    row.push(field);
    field = '';
    closed = false;
  }
  function endRow() {
    endField();
    if (row.some((cell) => cell !== '')) result.push(row);
    row = [];
    if (result.length > 101)
      throw new BadRequestException('Import at most 100 products at a time');
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"')
        throw new BadRequestException('Invalid CSV quoting');
      field += char;
    }
    if (row.length > 7 || field.length > 2000)
      throw new BadRequestException('CSV row or field is too large');
  }
  if (quoted)
    throw new BadRequestException('CSV contains an unclosed quoted field');
  if (field || closed || row.length) endRow();
  return result;
}

export function parseCatalogueCsv(value: unknown): ImportRow[] {
  const parsed = records(csvText(value));
  if (
    !parsed[0] ||
    parsed[0].map((v) => v.trim().toLowerCase()).join(',') !== headers.join(',')
  )
    throw new BadRequestException(`CSV headers must be: ${headers.join(',')}`);
  if (parsed.length < 2)
    throw new BadRequestException('CSV contains no products');
  const skus = new Set<string>(),
    codes = new Set<string>();
  return parsed.slice(1).map((cells, index) => {
    const [
      sku = '',
      name = '',
      categoryName = '',
      unit,
      price,
      barcodes = '',
      taxCode = '',
    ] = cells;
    const result: ImportRow = {
      row: index + 2,
      sku,
      name,
      categoryName: categoryName.trim(),
      input: null,
      errors: [],
    };
    if (cells.length !== headers.length) {
      result.errors.push('Expected seven columns');
      return result;
    }
    try {
      result.input = productInput({
        sku,
        name,
        categoryId: null,
        unit: unit.trim(),
        price: price.trim(),
        barcodes: barcodes.trim()
          ? barcodes.split('|').map((v) => v.trim())
          : [],
        taxCode,
        active: true,
      });
      if (categoryName.trim().length > 80)
        result.errors.push('Category name is too long');
      if (skus.has(result.input.sku))
        result.errors.push('Duplicate SKU in this file');
      skus.add(result.input.sku);
      for (const code of result.input.barcodes) {
        if (codes.has(code))
          result.errors.push(`Duplicate barcode in this file: ${code}`);
        codes.add(code);
      }
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      result.errors.push(error.message);
    }
    return result;
  });
}

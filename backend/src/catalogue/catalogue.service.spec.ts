import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { CatalogueService } from './catalogue.service.js';
import { CatalogueWrites } from './catalogue-writes.js';
import { CatalogueImportService } from './catalogue-import.service.js';

const query = vi.fn(),
  release = vi.fn();
const actor = { userId: 'manager', sessionId: 'session' };
const id = 'b292f92a-6f3a-4511-972f-d81ecba9b38c';
const input = {
  requestId: '7835ae0b-ed56-489d-a8cd-c05b5e35897f',
  reason: 'Price correction',
  sku: 'RICE',
  name: 'Rice',
  unit: 'kg',
  categoryId: null,
  price: '180.00',
  barcodes: [],
  taxCode: null,
  active: true,
  revision: 1,
};
let catalogue: CatalogueService, importer: CatalogueImportService;
beforeEach(async () => {
  vi.resetAllMocks();
  query.mockImplementation(async (sql: string) => ({
    rowCount: 1,
    rows: sql.startsWith('SELECT unit') ? [{ unit: 'kg', revision: 1 }] : [],
  }));
  const module = await Test.createTestingModule({
    providers: [
      CatalogueService,
      CatalogueImportService,
      CatalogueWrites,
      {
        provide: DatabaseService,
        useValue: {
          connectionPool: { query, connect: async () => ({ query, release }) },
        },
      },
    ],
  }).compile();
  catalogue = module.get(CatalogueService);
  importer = module.get(CatalogueImportService);
});
it('refuses a stale edit without changing products or history', async () => {
  await expect(
    catalogue.updateProduct(actor, id, { ...input, revision: 2 }),
  ).rejects.toThrow('product changed');
  expect(
    query.mock.calls.some(([sql]) =>
      String(sql).startsWith('UPDATE catalogue_product'),
    ),
  ).toBe(false);
  expect(query).toHaveBeenCalledWith('ROLLBACK');
});
it('refuses to reinterpret a product in a different sales unit', async () => {
  await expect(
    catalogue.updateProduct(actor, id, { ...input, unit: 'each' }),
  ).rejects.toThrow('sales unit cannot change');
  expect(
    query.mock.calls.some(([sql]) =>
      String(sql).startsWith('UPDATE catalogue_product'),
    ),
  ).toBe(false);
});
it('validates every import row before inserting any products', async () => {
  await expect(
    importer.import(actor, {
      requestId: input.requestId,
      reason: input.reason,
      csv: 'sku,name,category,unit,price,barcodes,tax_code\nRICE,Rice,,kg,180,,\nOIL,Oil,,l,1e3,,',
    }),
  ).rejects.toThrow('no longer passes validation');
  expect(
    query.mock.calls.some(([sql]) =>
      String(sql).startsWith('INSERT INTO catalogue_product'),
    ),
  ).toBe(false);
  expect(query).toHaveBeenCalledWith('ROLLBACK');
});
it('surfaces existing SKU/barcode/category conflicts in preview', async () => {
  query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith('SELECT sku')
      ? [{ sku: 'RICE' }]
      : sql.startsWith('SELECT code')
        ? [{ code: '001' }]
        : [],
  }));
  const preview = await importer.preview({
    csv: 'sku,name,category,unit,price,barcodes,tax_code\nRICE,Rice,Missing,kg,180,001,',
  });
  expect(preview.canImport).toBe(false);
  expect(preview.rows[0].errors).toHaveLength(3);
});

import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { CatalogueWrites } from './catalogue-writes.js';

const actor = { userId: 'manager', sessionId: 'session' };
const command = {
  requestId: '7835ae0b-ed56-489d-a8cd-c05b5e35897f',
  reason: 'Initial catalogue',
};
const payload = { action: 'product.create', priceMinor: '100' };
const query = vi.fn(),
  release = vi.fn(),
  work = vi.fn();
let writes: CatalogueWrites;
beforeEach(async () => {
  vi.resetAllMocks();
  query.mockResolvedValue({ rowCount: 1, rows: [] });
  work.mockResolvedValue({ product: { id: 'created-product' } });
  const module = await Test.createTestingModule({
    providers: [
      CatalogueWrites,
      {
        provide: DatabaseService,
        useValue: {
          connectionPool: { connect: async () => ({ query, release }) },
        },
      },
    ],
  }).compile();
  writes = module.get(CatalogueWrites);
});
it('returns a matching receipt without performing a second write', async () => {
  query.mockImplementation(async (sql: string) =>
    sql.startsWith('SELECT actor_id')
      ? {
          rows: [
            {
              actor_id: actor.userId,
              fingerprint: createHash('sha256')
                .update(JSON.stringify(payload))
                .digest('hex'),
              response: { product: { id: 'original-product' } },
            },
          ],
        }
      : { rows: [], rowCount: 1 },
  );
  await expect(writes.execute(actor, command, payload, work)).resolves.toEqual({
    product: { id: 'original-product' },
  });
  expect(work).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
it('rejects reuse with changed content', async () => {
  query.mockImplementation(async (sql: string) =>
    sql.startsWith('SELECT actor_id')
      ? {
          rows: [
            { actor_id: actor.userId, fingerprint: 'different', response: {} },
          ],
        }
      : { rows: [], rowCount: 1 },
  );
  await expect(writes.execute(actor, command, payload, work)).rejects.toThrow(
    'different change',
  );
  expect(work).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledWith('ROLLBACK');
});
it('rechecks manager authority inside the write transaction', async () => {
  query.mockImplementation(async (sql: string) => ({
    rows: [],
    rowCount: sql.startsWith('SELECT u.id') ? 0 : 1,
  }));
  await expect(writes.execute(actor, command, payload, work)).rejects.toThrow(
    'manager access',
  );
  expect(work).not.toHaveBeenCalled();
});
it('rolls back a failed write and does not save a success receipt', async () => {
  work.mockRejectedValue(new Error('private database details'));
  await expect(writes.execute(actor, command, payload, work)).rejects.toThrow(
    'could not be confirmed',
  );
  expect(query).toHaveBeenCalledWith('ROLLBACK');
  expect(
    query.mock.calls.some(([sql]) =>
      String(sql).startsWith('INSERT INTO catalogue_request'),
    ),
  ).toBe(false);
  expect(release).toHaveBeenCalledOnce();
});
it('saves the result in the same transaction before committing', async () => {
  await writes.execute(actor, command, payload, work);
  expect(query.mock.calls.at(-2)?.[0]).toContain(
    'INSERT INTO catalogue_request',
  );
  expect(query.mock.calls.at(-1)).toEqual(['COMMIT']);
});

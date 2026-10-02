import type { Pool } from 'pg';
import {
  bootstrapHostedManager,
  HostedManagerBootstrapError,
  parseHostedManagerInput,
} from './hosted-manager-bootstrap.js';

const environment: NodeJS.ProcessEnv = {
  STAFF_NAME: 'Initial Manager',
  STAFF_EMAIL: 'manager@example.test',
  STAFF_PASSWORD: 'unique-private-password',
  STAFF_ROLE: 'manager',
  STAFF_PROVISIONED_BY: 'cpanel-owner',
  STAFF_BOOTSTRAP_CONFIRM: 'CREATE_INITIAL_VERIFIED_MANAGER',
  STAFF_BOOTSTRAP_ATTEST_EMAIL_CONTROL: 'true',
};

function database(existing = false) {
  const query = vi.fn(async (sql: string) => ({
    rows:
      sql === 'SELECT id FROM "user" LIMIT 1' && existing
        ? [{ id: 'existing' }]
        : [],
  }));
  const release = vi.fn();
  return {
    pool: {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool,
    query,
    release,
  };
}

describe('hosted manager bootstrap', () => {
  it('requires explicit manager and email-control confirmation', () => {
    expect(parseHostedManagerInput(environment).role).toBe('manager');
    expect(() =>
      parseHostedManagerInput({
        ...environment,
        STAFF_BOOTSTRAP_ATTEST_EMAIL_CONTROL: undefined,
      }),
    ).toThrow(HostedManagerBootstrapError);
    expect(() =>
      parseHostedManagerInput({ ...environment, STAFF_ROLE: 'cashier' }),
    ).toThrow(HostedManagerBootstrapError);
    try {
      parseHostedManagerInput({
        ...environment,
        STAFF_BOOTSTRAP_CONFIRM: undefined,
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-confirmation' });
    }
    try {
      parseHostedManagerInput({ ...environment, STAFF_PASSWORD: 'short' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-input' });
    }
  });

  it('creates one verified manager with a hashed credential and audit record', async () => {
    const { pool, query, release } = database();
    const hash = vi.fn().mockResolvedValue('private-hash');

    await expect(
      bootstrapHostedManager(pool, parseHostedManagerInput(environment), hash),
    ).resolves.toMatch(/^[0-9a-f-]{36}$/);

    expect(hash).toHaveBeenCalledWith('unique-private-password');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"emailVerified"'),
      expect.arrayContaining([
        'Initial Manager',
        'manager@example.test',
        'manager',
      ]),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO account'),
      expect.arrayContaining(['credential', 'private-hash']),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO identity_audit'),
      expect.arrayContaining(['staff.provisioned', 'cpanel-owner']),
    );
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('refuses a second bootstrap and rolls back without inserting', async () => {
    const { pool, query, release } = database(true);

    await expect(
      bootstrapHostedManager(
        pool,
        parseHostedManagerInput(environment),
        vi.fn().mockResolvedValue('private-hash'),
      ),
    ).rejects.toMatchObject({ code: 'users-exist' });

    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "user"'),
      expect.anything(),
    );
    expect(release).toHaveBeenCalledOnce();
  });
});

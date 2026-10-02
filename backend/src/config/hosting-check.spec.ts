import { constants } from 'node:fs';
import { validateHostingConfiguration } from './hosting-check.js';

const environment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgresql://application:private@project.aivencloud.com:12345/defaultdb',
  DATABASE_TLS: 'verify',
  DATABASE_POOL_MAX: '3',
  NODE_EXTRA_CA_CERTS: '/private/aiven-ca.pem',
  BETTER_AUTH_SECRET: 'a-unique-random-secret-with-32-characters',
  BETTER_AUTH_URL: 'https://pos.example.test',
  AUTH_EMAIL_ENABLED: 'false',
  DARAJA_ENABLED: 'false',
};

describe('hosted configuration check', () => {
  it('validates application/auth settings and the Aiven CA path', async () => {
    const checkReadableFile = vi.fn().mockResolvedValue(undefined);

    await expect(
      validateHostingConfiguration(environment, checkReadableFile),
    ).resolves.toBeUndefined();
    expect(checkReadableFile).toHaveBeenCalledWith(
      '/private/aiven-ca.pem',
      constants.R_OK,
    );
  });

  it('reports a missing authentication secret without exposing values', async () => {
    await expect(
      validateHostingConfiguration(
        { ...environment, BETTER_AUTH_SECRET: undefined },
        vi.fn().mockResolvedValue(undefined),
      ),
    ).rejects.toThrow('BETTER_AUTH_SECRET');
  });

  it('requires a configured and readable Aiven CA certificate', async () => {
    await expect(
      validateHostingConfiguration(
        { ...environment, NODE_EXTRA_CA_CERTS: undefined },
        vi.fn(),
      ),
    ).rejects.toThrow('NODE_EXTRA_CA_CERTS is required');

    await expect(
      validateHostingConfiguration(
        environment,
        vi.fn().mockRejectedValue(new Error('private filesystem detail')),
      ),
    ).rejects.toThrow('must point to a readable Aiven CA certificate');
  });
});

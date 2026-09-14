import { DatabaseService } from './database.service.js';
import { parseEnvironment } from '../config/environment.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), on: vi.fn() }));
vi.mock('pg', () => ({
  Pool: class {
    query = mocks.query;
    end = mocks.end;
    on = mocks.on;
  },
}));

describe('DatabaseService', () => {
  beforeEach(() => vi.resetAllMocks());

  it('checks the database and closes its pool on shutdown', async () => {
    const service = new DatabaseService(
      parseEnvironment({
        DATABASE_URL: 'postgresql://test:fake@localhost/pay_and_go_test',
      }),
    );
    await service.checkConnection();
    expect(mocks.query).toHaveBeenCalledWith('SELECT 1');
    await service.onApplicationShutdown();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('propagates connection failures to the readiness handler', async () => {
    const service = new DatabaseService(
      parseEnvironment({
        DATABASE_URL: 'postgresql://test:fake@localhost/pay_and_go_test',
      }),
    );
    mocks.query.mockRejectedValue(new Error('unavailable'));
    await expect(service.checkConnection()).rejects.toThrow('unavailable');
    await service.onApplicationShutdown();
  });
});

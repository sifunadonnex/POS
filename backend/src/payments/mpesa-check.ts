import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';

// Configuration only: no HTTP, database connection or STK request is made.
try {
  loadLocalEnvironment();
  const config = parseEnvironment({
    ...process.env,
    DARAJA_ENABLED: 'true',
  }).daraja;
  if (!config) throw new Error('M-Pesa configuration is unavailable');
  const callback = new URL(config.callbackUrl);
  if (callback.pathname !== '/api/payment-attempts/mpesa/callback')
    throw new Error(
      'The callback must use /api/payment-attempts/mpesa/callback on the API serving this register',
    );
  console.log(
    JSON.stringify(
      {
        configuration: 'complete',
        enabled: process.env.DARAJA_ENABLED === 'true',
        environment: config.environment,
        transactionType: config.transactionType,
        separateReceivingTill: config.partyB !== config.shortCode,
        callback: process.env.DARAJA_CALLBACK_URL?.trim()
          ? 'explicit'
          : 'from application URL',
        callbackToken: process.env.DARAJA_CALLBACK_TOKEN?.trim()
          ? 'explicit'
          : 'automatic',
        providerContacted: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    `M-Pesa configuration incomplete: ${error instanceof Error ? error.message : 'Check server settings'}`,
  );
  process.exitCode = 1;
}

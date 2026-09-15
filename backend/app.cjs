// Passenger loads CommonJS; the compiled Nest application remains ESM.
process.chdir(__dirname);
import('./dist/main.js').catch(() => {
  console.error(
    'Pay & Go failed to start. Check runtime dependencies and server configuration.',
  );
  process.exit(1);
});

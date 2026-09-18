import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connect } from './db/index.js';

const config = loadConfig();
const { db, runMigrations, close } = connect(config.DATABASE_URL);

await runMigrations();
const app = await buildApp(config, db);
await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(close).finally(() => process.exit(0));
  });
}

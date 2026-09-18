import { Cron } from 'croner';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connect } from './db/index.js';

const config = loadConfig();
const { db, runMigrations, close } = connect(config.DATABASE_URL);

await runMigrations();
const app = await buildApp(config, db);
await app.listen({ host: config.HOST, port: config.PORT });

// Card data: refresh on a schedule, and fill an empty table right after first deploy.
const ingest = () =>
  app.cardIngest.start().catch((err: unknown) => app.log.error({ err }, 'card ingest could not start'));
const cron = config.SCRYFALL_INGEST_CRON ? new Cron(config.SCRYFALL_INGEST_CRON, { timezone: 'UTC' }, () => void ingest()) : null;
if ((await app.cardIngest.status()).cardCount === 0) setTimeout(ingest, 5_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    cron?.stop();
    void app.close().then(close).finally(() => process.exit(0));
  });
}

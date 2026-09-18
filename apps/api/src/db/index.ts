import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as schema from './schema.js';

export { schema };
export type { CardFace, CardIngestRow, CardRow, InviteRow, NewCardRow, UserRow } from './schema.js';

/** Driver-agnostic handle: production uses postgres-js, tests use PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Resolves to apps/api/drizzle both from src/ (tsx) and dist/ (node). */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function connect(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    runMigrations: () => migrate(db, { migrationsFolder }),
    close: () => client.end(),
  };
}

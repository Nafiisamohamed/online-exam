/**
 * Local PostgreSQL launcher (offline fallback).
 *
 * Purpose: campus networks may have no internet, so Supabase may be unreachable
 * during a demo. This script starts a real PostgreSQL 17 server from the
 * `embedded-postgres` npm package - no Docker or system install needed.
 *
 * Usage:   npm run db:local          (keeps running until Ctrl+C)
 * Then set DATABASE_URL=postgresql://postgres:postgres@localhost:5433/imtixaan
 *
 * Inputs (env, optional): LOCAL_DB_PORT (default 5433), LOCAL_DB_DIR (default ./.pgdata)
 * Errors: exits with code 1 if the server cannot start (e.g. port in use).
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.LOCAL_DB_PORT ?? 5433);
const dataDir = path.resolve(process.env.LOCAL_DB_DIR ?? path.join(__dirname, '..', '.pgdata'));

async function main(): Promise<void> {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  });
  const firstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  if (firstRun) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('imtixaan');
  } catch {
    /* database already exists */
  }
  console.log(`PostgreSQL running on port ${port}`);
  console.log(`DATABASE_URL=postgresql://postgres:postgres@localhost:${port}/imtixaan`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error('Could not start local PostgreSQL:', err);
  process.exit(1);
});

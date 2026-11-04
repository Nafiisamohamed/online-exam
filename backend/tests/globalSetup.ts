/**
 * Prepares the integration-test database once per test run.
 * If TEST_DATABASE_URL is empty, starts a throw-away embedded PostgreSQL on port 54330.
 * Then applies all Prisma migrations to it. Stops the embedded server afterwards.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import 'dotenv/config';

const TEST_PORT = 54330;

export default async function setup() {
  const external = process.env.TEST_DATABASE_URL;
  const url = external || `postgresql://postgres:postgres@localhost:${TEST_PORT}/imtixaan_test`;
  let stop: (() => Promise<void>) | undefined;

  if (!external) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imtixaan-pg-'));
    const pg = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'postgres',
      password: 'postgres',
      port: TEST_PORT,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('imtixaan_test');
    stop = async () => {
      await pg.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    };
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });

  return async () => {
    if (stop) await stop();
  };
}

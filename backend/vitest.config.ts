/**
 * Test configuration.
 * - Unit tests (tests/unit) need no database.
 * - Integration tests (tests/integration) use TEST_DATABASE_URL if set (CI uses a
 *   PostgreSQL service), otherwise tests/globalSetup.ts starts an embedded PostgreSQL.
 * Tests run in one process, one file at a time, because they share the test database.
 */
import { defineConfig } from 'vitest/config';
import 'dotenv/config';

const testDbUrl = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:54330/imtixaan_test';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDbUrl,
      DIRECT_URL: testDbUrl,
      JWT_SECRET: 'test-secret-that-is-long-enough-1234567890',
      DEADLINE_GRACE_SECONDS: '2',
      ENFORCE_NETWORK: 'true',
      RATE_LIMIT_PER_MINUTE: '100000',
      LOGIN_RATE_LIMIT_PER_15MIN: '100000',
    },
  },
});

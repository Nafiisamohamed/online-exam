/**
 * Server entry point.
 * Starts the HTTP API on all network interfaces (so campus devices can reach it) and the
 * background job that auto-submits attempts when their server deadline passes.
 */
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { startAutoSubmitJob } from './jobs/autoSubmit';

const app = createApp();
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Imtixaan API listening on http://0.0.0.0:${env.PORT}`);
});
const job = startAutoSubmitJob();

async function shutdown() {
  clearInterval(job);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

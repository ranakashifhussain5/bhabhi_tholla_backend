import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db/client.js';
import { attachSocketServer } from './realtime/index.js';

const config = loadConfig();
const jwtSecrets = {
  accessSecret: config.JWT_ACCESS_SECRET,
  refreshSecret: config.JWT_REFRESH_SECRET,
};
const app = buildApp({ prisma, jwtSecrets });

async function start(): Promise<void> {
  try {
    await app.ready();
    attachSocketServer(app.server, { prisma, jwtSecrets });
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  app.log.info('Shutting down...');
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

void start();

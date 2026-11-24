import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db/client.js';
import { attachSocketServer } from './realtime/index.js';

const config = loadConfig();
const jwtSecrets = {
  accessSecret: config.JWT_ACCESS_SECRET,
  refreshSecret: config.JWT_REFRESH_SECRET,
};
const app = await buildApp({ prisma, jwtSecrets });
let realtime: ReturnType<typeof attachSocketServer> | null = null;

async function start(): Promise<void> {
  try {
    await app.ready();
    realtime = attachSocketServer(app.server, { prisma, jwtSecrets, logger: app.log });
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  app.log.info('Shutting down...');
  realtime?.shutdown();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

void start();

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { attachSocketServer } from './realtime/index.js';

const config = loadConfig();
const app = buildApp();

async function start(): Promise<void> {
  try {
    await app.ready();
    attachSocketServer(app.server);
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

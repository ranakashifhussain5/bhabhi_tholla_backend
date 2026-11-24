import { connect } from 'node:net';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const url = new URL(databaseUrl);
const port = Number(url.port) || 5432;

const socket = connect({ host: url.hostname, port }, () => {
  console.log(`Postgres is reachable at ${url.hostname}:${port}`);
  socket.end();
  process.exit(0);
});

socket.on('error', (err) => {
  console.error(`Cannot reach Postgres at ${url.hostname}:${port}: ${err.message}`);
  process.exit(1);
});

socket.setTimeout(3000, () => {
  console.error(`Timed out waiting for Postgres at ${url.hostname}:${port}`);
  socket.destroy();
  process.exit(1);
});

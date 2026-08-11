import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createApiServer } from './server.js';

const databasePath = process.env.H3_STORYBOARD_DB
  ? resolve(process.env.H3_STORYBOARD_DB)
  : join(homedir(), '.h3storyboard', 'h3storyboard.db');
const port = parsePort(process.env.H3_STORYBOARD_PORT);
mkdirSync(dirname(databasePath), { recursive: true });

const api = createApiServer({
  database_path: databasePath,
  port,
});
const address = await api.start();
process.stdout.write(`H3Storyboard API listening at ${address.origin}\n`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await api.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 4187;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error('H3_STORYBOARD_PORT must be an integer from 0 to 65535');
  }
  return value;
}

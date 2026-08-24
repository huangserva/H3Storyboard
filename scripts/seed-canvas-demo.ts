import { resolve } from 'node:path';
import { seedCanvasDemo } from './canvas-demo-fixture.js';

const databasePath = resolve(process.env.H3_CANVAS_DEMO_DB ??
  '.h3storyboard/canvas-test.db');
const result = await seedCanvasDemo({ database_path: databasePath });
process.stdout.write(`Canvas demo ready\nDatabase: ${databasePath}\n` +
  `Project: ${result.project_id}\nWorker: disabled by demo:canvas\n`);

import { runWorkerTick } from '../services/notification-worker.js';
import { getPool } from '../db.js';
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
try {
  do { await runWorkerTick(); if (process.argv.includes('--once')) break; await new Promise(resolve => setTimeout(resolve, 60000)); } while (!stopped);
} finally { await getPool().end(); }

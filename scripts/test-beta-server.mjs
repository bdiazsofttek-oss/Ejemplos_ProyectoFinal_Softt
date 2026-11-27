import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createApplication } from '../services/api/src/server.js';
import { openDatabase } from '../services/api/src/db.js';

// Base en memoria: las pruebas nunca escriben en los datos personales de la beta.
const app = createApplication({ db: openDatabase(':memory:') });
app.server.listen(3150, '127.0.0.1');
const children = ['gestion', 'publica'].map((name, index) => {
  const cwd = resolve(import.meta.dirname, '../apps', name);
  return spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(5174 + index), '--strictPort'], { cwd, stdio: 'inherit' });
});
let stopping = false;
async function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill(); await app.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const child of children) child.on('exit', code => { if (!stopping) { process.exitCode = code || 1; stop(); } });

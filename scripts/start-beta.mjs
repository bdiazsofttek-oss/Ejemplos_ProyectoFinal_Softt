import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const viteCommand = process.argv.includes('--preview') ? ['node_modules/vite/bin/vite.js', 'preview'] : ['node_modules/vite/bin/vite.js'];
const services = [
  { name: 'api', cwd: resolve(root, 'services', 'api'), args: ['src/server.js'] },
  { name: 'gestion', cwd: resolve(root, 'apps', 'gestion'), args: [...viteCommand, '--port', '5174', '--host', '127.0.0.1', '--strictPort'] },
  { name: 'publica', cwd: resolve(root, 'apps', 'publica'), args: [...viteCommand, '--port', '5175', '--host', '127.0.0.1', '--strictPort'] }
];

for (const service of services) {
  if (!existsSync(resolve(service.cwd, service.args[0]))) {
    console.error(`Falta el ejecutable de ${service.name}. Ejecuta npm run setup desde la raíz.`);
    process.exit(1);
  }
}

const colors = { api: '\x1b[36m', gestion: '\x1b[32m', publica: '\x1b[35m' };
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  console.log('\nDeteniendo beta…');
  for (const child of children) child.kill();
}

for (const service of services) {
  const child = spawn(process.execPath, service.args, { cwd: service.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.add(child);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => process.stdout.write(`${colors[service.name]}[${service.name}]\x1b[0m ${chunk}`));
  child.on('error', error => {
    console.error(`[${service.name}] ${error.message}`);
    stop(1);
  });
  child.on('exit', code => {
    children.delete(child);
    if (!stopping) {
      console.error(`[${service.name}] terminó con código ${code}`);
      stop(code || 1);
    }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log('Beta iniciando. Gestión: http://127.0.0.1:5174 · Pública: http://127.0.0.1:5175/casa-demo');

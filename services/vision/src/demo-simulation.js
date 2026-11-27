import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const API = process.env.BETA_API || 'http://127.0.0.1:3150';
let token = process.env.BETA_TOKEN;
if (!token) {
  const login = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.BETA_EMAIL || 'admin@demo.local', password: process.env.BETA_PASSWORD || 'demo1234' }) });
  if (!login.ok) throw new Error('No se pudo iniciar sesión para el adaptador de visión');
  token = (await login.json()).accessToken;
}
const framesDir = resolve(import.meta.dirname, '../../../simulacion.1/simulacion');
const frames = (await readdir(framesDir)).filter(name => /^\d+\.jpg$/i.test(name)).sort();
if (!frames.length) throw new Error(`No se encontraron fotogramas en ${framesDir}`);

const response = await fetch(`${API}/api/restaurants/demo/vision-events`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    eventType: 'detection_summary', severity: 'info', source: 'simulacion.1/demo-adapter',
    payload: { frameCount: frames.length, firstFrame: frames[0], lastFrame: frames.at(-1), inference: false, note: 'Integración beta; Grounding DINO y SAM 2 pendientes de runtime Python.' }
  })
});
if (!response.ok) throw new Error(`La API respondió ${response.status}: ${await response.text()}`);
console.log(`Evento de integración enviado con ${frames.length} fotogramas.`, await response.json());

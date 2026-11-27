import { test, expect } from '@playwright/test';

const GESTION = 'http://127.0.0.1:5174';
const PUBLIC = 'http://127.0.0.1:5175';
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
async function login(page, address = 'admin@demo.local') {
  await page.goto(GESTION);
  await page.getByLabel('Correo', { exact: true }).fill(address);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.workspace')).toBeVisible();
}
const nav = (page, label) => page.locator('nav').getByRole('button', { name: label, exact: true }).click();

test('gestión, editor, reserva pública, cocina, entrega, cobro y visión', async ({ page, context }) => {
  await login(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await nav(page, 'Página digital');
  await expect(page.locator('#gjs iframe.gjs-frame')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Borrador guardado');
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Vista previa del borrador' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Publicar página', exact: true }).click();
  await expect(page.locator('#editor-status')).toContainText('Publicada:');

  const visitor = await context.newPage();
  await visitor.goto(PUBLIC);
  await visitor.getByRole('link', { name: 'Ver restaurante y reservar' }).click();
  await expect(visitor.getByRole('heading', { name: 'Casa Demo', exact: true })).toBeVisible();
  await visitor.getByLabel('Fecha', { exact: true }).fill(tomorrow());
  await visitor.getByRole('button', { name: 'Consultar disponibilidad' }).click();
  await visitor.getByLabel('Tu nombre').fill('Ana Beta');
  await visitor.getByLabel('Correo de confirmación').fill('ana@demo.local');
  await visitor.getByRole('checkbox').check();
  await visitor.getByRole('button', { name: 'Confirmar reserva' }).click();
  await expect(visitor.getByRole('heading', { name: 'Reserva confirmada', exact: true })).toBeVisible();
  await nav(page, 'Reservas');
  await expect(page.locator('#reservation-list')).toContainText('Ana Beta');
  await nav(page, 'Correos demo');
  await expect(page.locator('#view')).toContainText('ana@demo.local');
  await visitor.getByRole('button', { name: 'Cancelar mi reserva' }).click();
  await expect(visitor.getByRole('heading', { name: 'Reserva cancelada', exact: true })).toBeVisible();

  await nav(page, 'Mesas');
  await page.locator('[data-action="table-detail"][data-id="t4"]').click();
  await page.getByRole('button', { name: 'Tomar pedido', exact: true }).click();
  await page.getByLabel(/Tacos de temporada/).fill('1');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await nav(page, 'Cocina');
  let card = page.locator('.order-card').filter({ hasText: 'Mesa 4' });
  await card.getByRole('button', { name: 'Preparar', exact: true }).click();
  await card.getByRole('button', { name: 'Listo para entregar', exact: true }).click();
  await card.getByRole('button', { name: 'Marcar entregado', exact: true }).click();
  await nav(page, 'Mesas');
  await page.locator('[data-action="table-detail"][data-id="t4"]').click();
  await page.getByRole('button', { name: 'Solicitar cuenta', exact: true }).click();
  await page.locator('[data-action="table-detail"][data-id="t4"]').click();
  await page.getByRole('button', { name: 'Registrar cobro y liberar', exact: true }).click();
  await expect(page.locator('[data-action="table-detail"][data-id="t4"]')).toContainText('Libre');

  await nav(page, 'Visión y zonas');
  await expect(page.locator('#frame-image')).toBeVisible();
  await page.getByRole('button', { name: 'Dibujar zona', exact: true }).click();
  const canvas = page.locator('#zone-canvas');
  await canvas.click({ position: { x: 40, y: 40 } });
  await canvas.click({ position: { x: 180, y: 40 } });
  await canvas.click({ position: { x: 180, y: 140 } });
  await page.getByRole('button', { name: 'Guardar zona', exact: true }).click();
  await expect(page.locator('#view')).toContainText('3 puntos');
  await page.getByRole('button', { name: '1. Llegan comensales' }).click();
  await page.getByRole('button', { name: '2. Espera sin atención' }).click();
  await expect(page.locator('#observation')).toContainText('Alerta enviada');
  await page.screenshot({ path: 'test-results/vision-beta.png', fullPage: true });
  await nav(page, 'Alertas'); await expect(page.locator('#view')).toContainText('Mesa sin atender');
  await nav(page, 'Reportes'); await expect(page.locator('#view')).toContainText('$120.00');
  await page.screenshot({ path: 'test-results/reportes-beta.png', fullPage: true });
  for (const section of ['Menú', 'Equipo', 'Configuración']) { await nav(page, section); await expect(page.locator('#view')).not.toBeEmpty(); }
  const html = await (await page.request.get(PUBLIC + '/casa-demo')).text(); expect(html).toContain('Tacos de temporada');
  const sitemap = await (await page.request.get(PUBLIC + '/sitemap.xml')).text(); expect(sitemap).toContain('/casa-demo');
  expect(errors).toEqual([]);
});

test('roles de cocina y cuenta de cliente con sus reservas', async ({ page, context }) => {
  await login(page, 'cocina@demo.local');
  await expect(page.getByRole('heading', { name: 'Cocina', exact: true })).toBeVisible();
  await expect(page.locator('nav').getByRole('button', { name: 'Equipo', exact: true })).toHaveCount(0);
  const customer = await context.newPage(); await customer.goto(PUBLIC + '/cuenta');
  await customer.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(customer.getByRole('heading', { name: 'Mis reservas', exact: true })).toBeVisible();
  await customer.goto(PUBLIC + '/casa-demo');
  await customer.getByLabel('Fecha', { exact: true }).fill(tomorrow());
  await customer.getByRole('button', { name: 'Consultar disponibilidad' }).click();
  await customer.getByRole('checkbox').check();
  await customer.getByRole('button', { name: 'Confirmar reserva' }).click();
  await expect(customer.getByRole('heading', { name: 'Reserva confirmada', exact: true })).toBeVisible();
  await customer.getByRole('link', { name: 'Mis reservas', exact: true }).click();
  await customer.getByRole('button', { name: 'Cancelar reserva', exact: true }).click();
  await expect(customer.locator('.reservation-row')).toContainText('cancelled');
});

test('PWA conserva el último plano en modo offline y permite consulta', async ({ page, context }) => {
  await login(page); await nav(page, 'Mesas');
  await expect(page.locator('.tables .table')).toHaveCount(6);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('#view')).toContainText('Sin conexión: último plano guardado');
  await expect(page.locator('.tables .table')).toHaveCount(6);
  await context.setOffline(false);
});

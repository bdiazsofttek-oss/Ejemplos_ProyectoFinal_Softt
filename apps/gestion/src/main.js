import './styles.css';
const API = import.meta.env.VITE_BETA_API || 'http://127.0.0.1:3150';
const PUBLIC = 'http://127.0.0.1:5175';
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format((cents || 0) / 100);
const dateTime = value => value ? new Date(value).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '—';
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const labels = { free:'Libre', occupied:'Ocupada', ordered:'Con pedido', waiting:'Sin atender', bill:'Cuenta', new:'Nuevo', preparing:'Preparando', ready:'Listo', served:'Entregado', paid:'Pagado', cancelled:'Cancelado', confirmed:'Confirmada', arrived:'Llegó', completed:'Completada', gerente:'Gerente', mesero:'Mesero', cocina:'Cocina', platform_admin:'Administrador' };
let saved; try { saved = JSON.parse(localStorage.getItem('rp-session')); } catch {}
const state = { session: saved, rid: localStorage.getItem('rp-restaurant') || saved?.user?.restaurantId || 'demo', tab:'dashboard', editor:null, ws:null, timer:null, offline:false, data:{}, points:[], drawing:false, frame:0, frameUrl:null, renderId:0 };
const app = document.querySelector('#app');
const manager = () => ['gerente','platform_admin'].includes(state.session?.user?.role);
const service = () => ['gerente','platform_admin','mesero'].includes(state.session?.user?.role);
const kitchen = () => ['gerente','platform_admin','cocina'].includes(state.session?.user?.role);
const base = () => '/api/restaurants/' + state.rid;
const snapshotKey = () => 'rp-floor-' + state.session.user.id + '-' + state.rid;
const tabs = () => [
  ...(state.session.user.role === 'platform_admin' ? [['restaurants','Restaurantes']] : []),
  ...(manager() ? [['dashboard','Resumen']] : []),
  ['floor','Mesas'], ['orders','Pedidos'], ['kitchen','Cocina'],
  ...(service() ? [['reservations','Reservas'],['alerts','Alertas']] : []),
  ...(manager() ? [['products','Menú'],['vision','Visión y zonas'],['page','Página digital'],['reports','Reportes'],['mail','Correos demo'],['users','Equipo'],['settings','Configuración']] : [])
];
async function request(path, options = {}) {
  let response;
  try { response = await fetch(API + path, { ...options, headers: { 'content-type':'application/json', ...(state.session ? { authorization:'Bearer ' + state.session.accessToken } : {}) } }); }
  catch { throw new Error('No se puede conectar con la API. Revisa que esté iniciada.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 && state.session) logout(false); throw new Error(data.error || 'Solicitud inválida'); }
  return data;
}
const post = (path, data = {}) => request(path, { method:'POST', body:JSON.stringify(data) });
function toast(message, error = false) {
  let target = document.querySelector('#toast');
  if (!target) { target = document.createElement('div'); target.id = 'toast'; target.setAttribute('role','status'); document.body.append(target); }
  target.textContent = message; target.className = error ? 'toast error' : 'toast';
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => target.remove(), 6000);
}
function loginView(message = '') {
  state.ws?.close(); clearTimeout(state.timer);
  app.innerHTML = `<main class="login-shell"><form id="login" class="login-card"><span class="eyebrow">RESTAURANT PLATFORM · BETA 0.2</span><h1>Iniciar sesión</h1><p>Prueba la operación completa de un restaurante.</p>${message ? '<p class="error">' + e(message) + '</p>' : ''}<label>Correo<input name="email" type="email" value="admin@demo.local" required></label><label>Contraseña<input name="password" type="password" value="demo1234" required></label><button>Entrar</button><details><summary>Accesos de prueba</summary><p>Contraseña para todos: demo1234</p><p>Gerente: admin@demo.local<br>Mesero: mesero@demo.local<br>Cocina: cocina@demo.local<br>Plataforma: plataforma@demo.local</p></details><a href="${PUBLIC}" target="_blank" rel="noopener">Abrir directorio público ↗</a></form></main>`;
  document.querySelector('#login').onsubmit = async event => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try { const session = await post('/api/auth/login', Object.fromEntries(new FormData(event.currentTarget))); if (session.user.role === 'customer') throw new Error('Las cuentas de cliente entran en el sitio público.'); state.session = session; state.rid = session.user.restaurantId || 'demo'; state.tab = session.user.role === 'cocina' ? 'kitchen' : session.user.role === 'mesero' ? 'floor' : session.user.role === 'platform_admin' ? 'restaurants' : 'dashboard'; localStorage.setItem('rp-session',JSON.stringify(session)); await loadShell(); }
    catch (error) { loginView(error.message); }
  };
}
async function logout(remote = true) {
  const session = state.session;
  if (remote && session) await post('/api/auth/logout').catch(() => {});
  if (session) localStorage.removeItem(snapshotKey());
  state.session = null; localStorage.removeItem('rp-session'); state.ws?.close(); clearTimeout(state.timer); state.editor?.destroy(); state.editor = null; loginView();
}
async function loadShell() {
  try {
    state.session.user = await request('/api/auth/me');
    if (state.session.user.role === 'customer') return logout();
    state.restaurants = await request('/api/restaurants');
    if (!state.restaurants.some(r => r.id === state.rid)) state.rid = state.restaurants[0]?.id;
    if (!state.rid) throw new Error('No hay restaurantes en la sesión');
    state.restaurant = state.restaurants.find(r => r.id === state.rid); state.offline = false;
    localStorage.setItem('rp-session',JSON.stringify(state.session)); localStorage.setItem('rp-profile-' + state.rid,JSON.stringify(state.restaurant));
  } catch (error) {
    if (!state.session) return;
    let cached; try { cached = JSON.parse(localStorage.getItem('rp-profile-' + state.rid)); } catch {}
    if (!cached) return loginView(error.message);
    state.restaurant = cached; state.restaurants = [cached]; state.offline = true; state.tab = 'floor';
  }
  if (!tabs().some(([id]) => id === state.tab)) state.tab = tabs()[0][0];
  app.innerHTML = `<div class="shell"><aside><div class="brand"><span>RP</span><div><strong>${e(state.restaurant.name)}</strong><small>${e(labels[state.session.user.role])}</small></div></div>${state.restaurants.length > 1 ? '<label class="tenant-label">Restaurante<select id="tenant">' + state.restaurants.map(r => '<option value="' + e(r.id) + '"' + (r.id === state.rid ? ' selected' : '') + '>' + e(r.name) + '</option>').join('') + '</select></label>' : ''}<nav>${tabs().map(([id,label]) => `<button data-tab="${id}"><span>${label}</span></button>`).join('')}</nav><div class="aside-foot"><button data-action="logout">Cerrar sesión</button></div></aside><section class="workspace"><header><div><span class="eyebrow">${e(state.restaurant.name)}</span><h1 id="view-title"></h1></div><div class="header-tools"><span class="status" id="connection">Conectando…</span><button class="secondary" data-action="sound">Activar sonido</button><a href="${PUBLIC}/${e(state.restaurant.slug)}" target="_blank" rel="noopener">Página pública ↗</a></div></header><div id="view"></div></section></div><dialog id="dialog"></dialog>`;
  document.querySelector('#tenant')?.addEventListener('change', async event => { state.rid = event.target.value; localStorage.setItem('rp-restaurant',state.rid); await loadShell(); });
  if (!state.offline) connectLive(); else document.querySelector('#connection').textContent = 'Sin conexión · solo consulta';
  await render(state.tab);
}
function connectLive() {
  clearTimeout(state.timer); state.ws?.close();
  const ws = new WebSocket(API.replace(/^http/,'ws') + '/ws'); state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ token:state.session.accessToken, restaurantId:state.rid }));
  ws.onmessage = async event => {
    const data = JSON.parse(event.data);
    if (data.type === 'connected') { document.querySelector('#connection').textContent = 'En vivo'; return; }
    if (data.entity === 'vision' || data.entity === 'vision-events') {
      if (state.audio) { const oscillator = state.audio.createOscillator(); const gain = state.audio.createGain(); gain.gain.value = 0.08; oscillator.connect(gain).connect(state.audio.destination); oscillator.start(); oscillator.stop(state.audio.currentTime + 0.15); navigator.vibrate?.([120,80,120]); }
      toast('Actualización de visión recibida');
    }
    const editing = ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName) || document.querySelector('#dialog')?.open;
    if (!editing && ['floor','orders','kitchen','reservations','alerts','dashboard','reports'].includes(state.tab)) render(state.tab).catch(error => toast(error.message,true));
  };
  ws.onclose = () => { if (state.ws !== ws || !state.session) return; const badge = document.querySelector('#connection'); if (badge) badge.textContent = 'Reconectando…'; state.timer = setTimeout(connectLive,3000); };
  ws.onerror = () => {};
}
function dialog(title, form, fields, extra = '') {
  const target = document.querySelector('#dialog');
  target.innerHTML = `<form data-form="${form}"><h2>${e(title)}</h2>${fields}${extra}<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-action="close-dialog">Cancelar</button><button type="submit">Guardar</button></div></form>`;
  target.showModal();
}
const field = (label, name, value = '', type = 'text', attrs = '') => `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${attrs}></label>`;
const select = (label, name, options) => `<label>${label}<select name="${name}">${options}</select></label>`;
const button = (label, action, id = '', extra = '') => `<button class="secondary" data-action="${action}" data-id="${e(id)}" ${extra}>${label}</button>`;
const status = value => `<span class="tag ${e(value)}">${e(labels[value] || value)}</span>`;
const panel = (title, body, actions = '') => `<section class="panel"><div class="panel-head"><h2>${title}</h2><div class="actions">${actions}</div></div>${body}</section>`;
const empty = '<p class="empty">No hay registros todavía.</p>';

async function render(tab) {
  if (!state.session) return;
  if (!tabs().some(([id]) => id === tab)) throw new Error('Sección no disponible para tu rol');
  if (state.editor && tab !== 'page') { state.editor.destroy(); state.editor = null; }
  const renderId = ++state.renderId; state.tab = tab;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active',b.dataset.tab === tab));
  document.querySelector('#view-title').textContent = tabs().find(([id]) => id === tab)[1];
  const view = document.querySelector('#view');
  const get = name => request(base() + '/' + name);
  let content = '';
  if (tab === 'dashboard' || tab === 'reports') {
    const r = await get('reports'); const metrics = [['Mesas ocupadas',r.occupied + ' / ' + r.tables],['Pedidos activos',r.activeOrders],['Ventas registradas',money(r.revenueCents)],['Reservas',r.reservations],['Alertas pendientes',r.alerts],['Primera atención',r.averageFirstServiceSeconds === null ? 'Sin datos' : r.averageFirstServiceSeconds + ' s']];
    content = '<div class="metrics">' + metrics.map(([label,value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('') + '</div>';
    content += panel('Recorrido de prueba', '<ol class="steps"><li>Configura el perfil, mesas, menú y equipo.</li><li>Diseña y publica la página del restaurante.</li><li>Reserva desde la web pública y registra la llegada aquí.</li><li>Toma un pedido, prepáralo en cocina y márcalo como entregado.</li><li>Solicita la cuenta, registra el cobro demo y libera la mesa.</li><li>Prueba visión y revisa las alertas y los reportes.</li></ol><p>Los importes son registros locales de prueba. El correo se consulta en Correos demo.</p>',button('Ir a configuración','navigate','settings'));
  } else if (tab === 'floor') {
    let ts;
    try { ts = await get('tables'); localStorage.setItem(snapshotKey(),JSON.stringify({ tables:ts,at:new Date().toISOString() })); }
    catch (error) { const cached = JSON.parse(localStorage.getItem(snapshotKey()) || 'null'); if (!cached) throw error; ts = cached.tables; state.offline = true; }
    state.data.tables = ts;
    content = panel('Plano de mesas', `${state.offline ? '<p class="note">Sin conexión: último plano guardado. Las acciones requieren conexión.</p>' : ''}<div class="tables">${ts.map(t => `<button class="table ${e(t.status)}" data-action="table-detail" data-id="${e(t.id)}"><span>${e(t.label)}</span><strong>${labels[t.status]}</strong><small>${t.seats} personas</small></button>`).join('')}</div>`, (manager() ? button('+ Mesa','new-table') : '') + button('Actualizar','refresh'));
  } else if (tab === 'orders' || tab === 'kitchen') {
    const orders = await get('orders'); state.data.orders = orders;
    const card = o => `<article class="order-card"><div class="row"><strong>${e(o.tableLabel)}</strong>${status(o.status)}</div><p>${e(o.item)}</p><small>${e(o.notes)} · ${dateTime(o.createdAt)}</small><p>${money(o.totalCents)}</p><div class="actions">${kitchen() && o.status === 'new' ? button('Preparar','order-state',o.id,'data-status="preparing"') : ''}${kitchen() && o.status === 'preparing' ? button('Listo para entregar','order-state',o.id,'data-status="ready"') : ''}${service() && o.status === 'ready' ? button('Marcar entregado','order-state',o.id,'data-status="served"') : ''}${service() && ['new','preparing'].includes(o.status) ? button('Cancelar pedido','order-state',o.id,'data-status="cancelled"') : ''}</div></article>`;
    if (tab === 'kitchen') content = '<div class="board">' + ['new','preparing','ready'].map(s => panel(labels[s],orders.filter(o => o.status === s).map(card).join('') || empty)).join('') + '</div>';
    else content = panel('Pedidos', orders.map(card).join('') || empty, (service() ? button('+ Pedido','new-order') : '') + button('Actualizar','refresh'));
  } else if (tab === 'products') {
    const products = await get('products'); state.data.products = products;
    content = panel('Menú y productos', '<div class="list">' + products.map(p => `<article class="list-row"><div><strong>${e(p.name)}</strong><small>${e(p.category)} · ${money(p.priceCents)} · ${p.active ? 'Disponible' : 'Oculto'}</small></div><div class="actions">${button('Editar','edit-product',p.id)}${button(p.active ? 'Ocultar' : 'Activar','toggle-product',p.id)}</div></article>`).join('') + '</div>',button('+ Producto','new-product'));
  } else if (tab === 'reservations') {
    const reservations = await get('reservations'); state.data.reservations = reservations;
    content = panel('Reservas', field('Filtrar por fecha','reservationDate','','date') + '<div id="reservation-list">' + reservationRows(reservations) + '</div>',button('+ Reserva','new-reservation') + button('Actualizar','refresh'));
  } else if (tab === 'users') {
    const users = await get('users');
    content = panel('Equipo y permisos', users.map(u => `<article class="list-row"><div><strong>${e(u.name)}</strong><small>${e(u.email)} · ${e(labels[u.role])} · ${u.active ? 'Activo' : 'Desactivado'}</small></div>${u.active && u.id !== state.session.user.id ? button('Desactivar','disable-user',u.id) : ''}</article>`).join(''),button('+ Usuario','new-user'));
  } else if (tab === 'settings') {
    const r = await request(base()); state.restaurant = r;
    content = panel('Perfil del restaurante', `<form data-form="profile" class="form-grid">${profileFields(r)}<label><input name="active" type="checkbox" ${r.active ? 'checked' : ''}> Visible en el directorio al publicar</label><button>Guardar configuración</button></form>`);
  } else if (tab === 'restaurants') {
    const restaurants = await request('/api/restaurants');
    content = panel('Restaurantes de la plataforma', restaurants.map(r => `<article class="list-row"><div><strong>${e(r.name)}</strong><small>${e(r.city)} · /${e(r.slug)}</small></div>${button('Administrar','select-restaurant',r.id)}</article>`).join('') + '<p>Después de crear un restaurante agrega mesas, productos y su gerente en Equipo.</p>',button('+ Restaurante','new-restaurant'));
  } else if (tab === 'alerts') {
    const list = await get('vision-events');
    content = panel('Alertas de atención',list.map(v => `<article class="list-row"><div><strong>${v.eventType === 'table_unattended' ? 'Mesa sin atender' : 'Observación de escena'}</strong><small>${e(v.tableId || 'Escena')} · ${dateTime(v.occurredAt)} · ${v.acknowledgedAt ? 'Reconocida' : e(v.severity)}</small><p>${v.payload.inference === false ? 'Simulación guiada' : e(v.source)} ${v.payload.secondsSinceService ? '· ' + v.payload.secondsSinceService + ' segundos' : ''}</p></div>${!v.acknowledgedAt && v.eventType === 'table_unattended' ? button('Reconocer alerta','ack',v.id) : ''}</article>`).join('') || empty,button('Actualizar','refresh'));
  } else if (tab === 'mail') {
    const list = await get('mail');
    content = panel('Bandeja de correos de prueba','<p class="note">Los correos se guardan aquí; no se envían a direcciones reales.</p>' + list.map(m => `<article class="mail"><strong>${e(m.subject)}</strong><small>Para: ${e(m.recipient)} · ${dateTime(m.createdAt)}</small><p>${e(m.body)}</p></article>`).join(''));
  } else if (tab === 'vision') {
    const [ts,zones,frames] = await Promise.all([get('tables'),get('zones'),get('vision/frames')]); state.data.tables = ts; state.data.zones = zones; state.data.frames = frames;
    content = panel('Escena y calibración', `<p class="note">Modo demo guiado. Los fotogramas son reales; las observaciones se introducen con los botones. DINO/SAM todavía no ejecutan inferencia.</p><div class="form-grid">${select('Mesa de la escena','visionTable',ts.map(t => `<option value="${t.id}">${e(t.label)}</option>`).join(''))}${select('Fotograma','frame',frames.map(f => `<option value="${f.index}" ${f.index === state.frame ? 'selected' : ''}>${f.name}</option>`).join(''))}</div><div class="vision-scene"><img id="frame-image" alt="Fotograma de simulación"><svg id="zone-canvas" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg></div><p id="zone-hint">Selecciona una mesa y dibuja su zona sobre la imagen.</p><div class="actions">${button('Dibujar zona','draw-zone')}${button('Guardar zona','save-zone')}${button('Borrar puntos','clear-zone')}</div><div class="actions scenario">${button('1. Llegan comensales','observe','arrive')}${button('2. Espera sin atención','observe','wait')}${button('3. Mesero atiende','observe','attend')}${button('4. Llega un platillo','observe','dish')}</div><div id="observation"></div><h3>Zonas guardadas</h3>${zones.map(z => '<p>' + e(ts.find(t => t.id === z.tableId)?.label || z.tableId) + ' · ' + z.points.length + ' puntos ' + button('Eliminar zona','delete-zone',z.id) + '</p>').join('') || empty}`);
  } else if (tab === 'page') return pageView(renderId);
  if (state.renderId !== renderId) return;
  view.innerHTML = content;
  if (tab === 'vision') { state.drawing = false; state.points = []; await loadFrame(); drawZones(); }
}
function profileFields(r = {}) {
  return field('Nombre','name',r.name || '','text','required') + field('Dirección pública (slug)','slug',r.slug || '','text','required pattern="[a-z0-9-]{3,60}"') + field('Ciudad','city',r.city || '','text','required') + field('Tipo de cocina','cuisine',r.cuisine || 'Mexicana','text','required') + field('Dirección','address',r.address || '') + field('Descripción','description',r.description || '') + field('Apertura','openingTime',r.openingTime || '09:00','time','required') + field('Cierre','closingTime',r.closingTime || '23:00','time','required') + field('Umbral sin atención (segundos)','thresholdSeconds',r.thresholdSeconds || 90,'number','min="15" max="3600" required');
}
function reservationRows(list) { return list.map(r => `<article class="list-row"><div><strong>${e(r.name)} · ${e(r.tableLabel)}</strong><small>${dateTime(r.startsAt)} · ${r.guests} personas · ${e(r.email)}</small>${status(r.status)}</div><div class="actions">${r.status === 'confirmed' ? button('Marcar llegada','reservation-state',r.id,'data-status="arrived"') + button('Cancelar reserva','reservation-state',r.id,'data-status="cancelled"') : ''}</div></article>`).join('') || empty; }
async function newOrder(tid = '') {
  const [ts,ps] = await Promise.all([request(base() + '/tables'),request(base() + '/products')]);
  const products = ps.filter(p => p.active); state.data.orderProducts = products;
  dialog('Nuevo pedido','order',select('Mesa','tableId',ts.map(t => `<option value="${e(t.id)}" ${t.id === tid ? 'selected' : ''}>${e(t.label)}</option>`).join('')) + products.map(p => field(e(p.name) + ' · ' + money(p.priceCents),'qty_' + p.id,0,'number','min="0" max="99"')).join('') + field('Notas para cocina','notes'));
}
function productDialog(product = {}) {
  state.editingProduct = product.id || null;
  dialog(product.id ? 'Editar producto' : 'Nuevo producto','product',field('Nombre','name',product.name,'text','required') + field('Categoría','category',product.category || 'Platillos','text','required') + field('Descripción','description',product.description) + field('Precio en pesos','price',product.priceCents ? product.priceCents / 100 : 0,'number','min="0" step="0.01" required'));
}
function newReservation() {
  dialog('Nueva reserva','reservation',field('Fecha','date',localDate(),'date','required') + field('Hora','time','14:00','time','required') + field('Personas','guests',2,'number','min="1" max="30" required') + button('Consultar mesas','availability') + select('Mesa disponible','tableId','<option value="">Primero consulta disponibilidad</option>') + field('Nombre del cliente','name','','text','required') + field('Correo de confirmación','email','','email','required') + '<label><input type="checkbox" name="consent" required> El cliente acepta usar sus datos para gestionar esta reserva.</label>');
}
async function pageView(renderId) {
  const [page,history] = await Promise.all([request(base() + '/page'),request(base() + '/page/history')]);
  if (state.renderId !== renderId) return;
  state.editor?.destroy();
  const { default:grapesjs } = await import('grapesjs'); await import('grapesjs/dist/css/grapes.min.css');
  if (state.renderId !== renderId) return;
  document.querySelector('#view').innerHTML = `<section class="editor-panel"><div class="editor-toolbar"><strong>Página de ${e(state.restaurant.name)}</strong><div>${button('Guardar borrador','save-page')}${button('Vista previa','preview-page')}${button('Publicar página','publish-page')}</div></div><div class="history">${select('Versión publicada','version', '<option value="">Seleccionar versión</option>' + history.map(h => '<option value="' + e(h.id) + '">' + dateTime(h.publishedAt) + '</option>').join(''))}${button('Restaurar como borrador','restore-page')}</div><div id="gjs"></div><p id="editor-status" class="editor-status">${page.publishedAt ? 'Publicada: ' + dateTime(page.publishedAt) : 'Sin publicar'} · Los cambios se guardan como borrador.</p></section>`;
  state.editor = grapesjs.init({ container:'#gjs',height:'65vh',storageManager:false,projectData:page.projectData, canvas:{ scripts:[] } });
  const blocks = state.editor.Blocks;
  blocks.add('hero',{label:'Portada',category:'Secciones',content:'<section style="padding:60px 24px;text-align:center;background:#235638;color:white"><h1>Tu restaurante</h1><p>Una experiencia para compartir.</p></section>'});
  blocks.add('text',{label:'Historia',category:'Secciones',content:'<section style="padding:32px"><h2>Nuestra historia</h2><p>Escribe aquí tu historia.</p></section>'});
  blocks.add('menu',{label:'Menú',category:'Secciones',content:'<section style="padding:32px"><h2>Especialidades</h2><p>El menú y la reserva estarán disponibles debajo de tu página.</p></section>'});
  blocks.add('contact',{label:'Contacto',category:'Secciones',content:'<footer style="padding:32px"><h2>Visítanos</h2><p>Dirección y horarios del restaurante.</p></footer>'});
}
async function savePage() {
  await request(base() + '/page',{method:'PUT',body:JSON.stringify({projectData:state.editor.getProjectData(),html:state.editor.getHtml(),css:state.editor.getCss()})});
  document.querySelector('#editor-status').textContent = 'Borrador guardado: ' + new Date().toLocaleTimeString();
}
async function loadFrame() {
  const response = await fetch(API + base() + '/vision/frames/' + state.frame,{headers:{authorization:'Bearer ' + state.session.accessToken}});
  if (!response.ok) throw new Error('No se pudo cargar el fotograma');
  if (state.frameUrl) URL.revokeObjectURL(state.frameUrl);
  state.frameUrl = URL.createObjectURL(await response.blob()); document.querySelector('#frame-image').src = state.frameUrl;
}
function drawZones() {
  const canvas = document.querySelector('#zone-canvas'); if (!canvas) return;
  canvas.innerHTML = (state.data.zones || []).map(z => '<polygon points="' + z.points.map(p => p.map(n => n * 1000).join(',')).join(' ') + '" fill="#22c55e33" stroke="#22c55e" stroke-width="4"/>').join('') + (state.points.length ? '<polyline points="' + state.points.map(p => p.map(n => n * 1000).join(',')).join(' ') + '" fill="#f59e0b33" stroke="#f59e0b" stroke-width="5"/>' : '') + state.points.map(p => '<circle cx="' + p[0]*1000 + '" cy="' + p[1]*1000 + '" r="8" fill="#f59e0b"/>').join('');
  canvas.style.cursor = state.drawing ? 'crosshair' : 'default';
}

app.addEventListener('click', async event => {
  const nav = event.target.closest('[data-tab]'); if (nav) { try { await render(nav.dataset.tab); } catch(error) { toast(error.message,true); } return; }
  if (event.target.closest('#zone-canvas') && state.drawing) {
    const rect = document.querySelector('#zone-canvas').getBoundingClientRect();
    if (state.points.length < 20) state.points.push([(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height]); drawZones();
    document.querySelector('#zone-hint').textContent = state.points.length + ' puntos. Guarda al terminar.'; return;
  }
  const target = event.target.closest('[data-action]'); if (!target) return;
  const action = target.dataset.action; const id = target.dataset.id;
  target.disabled = true;
  try {
    if (action === 'logout') return await logout();
    if (action === 'close-dialog') return document.querySelector('#dialog').close();
    if (action === 'navigate') return await render(id);
    if (action === 'refresh') { state.offline = false; return await render(state.tab); }
    if (action === 'sound') { state.audio = new (window.AudioContext || window.webkitAudioContext)(); await state.audio.resume(); target.textContent = 'Sonido activado'; return; }
    if (action === 'select-restaurant') { state.rid = id; state.tab = 'dashboard'; localStorage.setItem('rp-restaurant',id); return await loadShell(); }
    if (state.offline) throw new Error('Esta acción requiere conexión con la API');
    if (action === 'new-table') { state.editingTable = null; return dialog('Nueva mesa','table',field('Nombre','label','','text','required') + field('Capacidad','seats',4,'number','min="1" max="30" required')); }
    if (action === 'table-detail') {
      const t = state.data.tables.find(t => t.id === id);
      const orders = (await request(base() + '/orders')).filter(o => o.tableId === id && !['paid','cancelled'].includes(o.status));
      const dlg = document.querySelector('#dialog');
      dlg.innerHTML = `<h2>${e(t.label)}</h2><p>${status(t.status)} · ${t.seats} personas</p><p>Total pendiente: ${money(orders.reduce((n,o) => n + o.totalCents,0))}</p>${orders.map(o => '<p>' + e(o.item) + ' · ' + e(labels[o.status]) + '</p>').join('')}<div class="actions">${service() ? (t.status === 'free' ? button('Ocupar mesa','table-action',id,'data-command="occupy"') : button('Solicitar cuenta','table-action',id,'data-command="request-bill"') + button('Registrar cobro y liberar','table-action',id,'data-command="checkout"')) + button('Tomar pedido','new-order',id) : ''}${manager() ? button('Editar mesa','edit-table',id) + button('Retirar mesa','delete-table',id) : ''}${button('Cerrar','close-dialog')}</div>`;
      dlg.showModal(); return;
    }
    if (action === 'edit-table') { const t = state.data.tables.find(t => t.id === id); document.querySelector('#dialog').close(); state.editingTable = id; return dialog('Editar mesa','table',field('Nombre','label',t.label,'text','required') + field('Capacidad','seats',t.seats,'number','min="1" max="30" required')); }
    if (action === 'delete-table') { await request(base() + '/tables/' + id,{method:'DELETE'}); document.querySelector('#dialog').close(); await render('floor'); return; }
    if (action === 'table-action') { const result = await post(base() + '/tables/' + id + '/' + target.dataset.command); document.querySelector('#dialog').close(); toast(result.paymentMode ? 'Cobro demo registrado: ' + money(result.totalCents) : 'Mesa actualizada'); return await render('floor'); }
    if (action === 'new-order') { document.querySelector('#dialog').close(); return await newOrder(id); }
    if (action === 'order-state') { await request(base() + '/orders/' + id,{method:'PATCH',body:JSON.stringify({status:target.dataset.status})}); return await render(state.tab); }
    if (action === 'new-product') return productDialog();
    if (action === 'edit-product') return productDialog(state.data.products.find(p => p.id === id));
    if (action === 'toggle-product') { const p = state.data.products.find(p => p.id === id); await request(base() + '/products/' + id,{method:'PATCH',body:JSON.stringify({...p,active:!p.active})}); return await render('products'); }
    if (action === 'new-reservation') return newReservation();
    if (action === 'availability') {
      const form = target.closest('form'); const input = Object.fromEntries(new FormData(form));
      const list = await request('/public/restaurants/' + state.restaurant.slug + '/availability?' + new URLSearchParams({date:input.date,time:input.time,guests:input.guests}));
      form.querySelector('[name=tableId]').innerHTML = list.length ? list.map(t => '<option value="' + e(t.id) + '">' + e(t.label) + ' · ' + t.seats + ' personas</option>').join('') : '<option value="">Sin disponibilidad</option>';
      return toast(list.length ? 'Mesas disponibles actualizadas' : 'No hay mesas para ese horario');
    }
    if (action === 'reservation-state') { await request(base() + '/reservations/' + id,{method:'PATCH',body:JSON.stringify({status:target.dataset.status})}); return await render('reservations'); }
    if (action === 'new-user') return dialog('Nuevo integrante','user',field('Nombre','name','','text','required') + field('Correo','email','','email','required') + field('Contraseña','password','','password','minlength="8" required') + select('Rol','role','<option value="mesero">Mesero</option><option value="cocina">Cocina</option><option value="gerente">Gerente</option>'));
    if (action === 'disable-user') { await request(base() + '/users/' + id,{method:'DELETE'}); return await render('users'); }
    if (action === 'new-restaurant') return dialog('Nuevo restaurante','restaurant',profileFields());
    if (action === 'ack') { await post(base() + '/vision-events/' + id + '/ack'); return await render('alerts'); }
    if (action === 'draw-zone') { state.drawing = true; state.points = []; drawZones(); return; }
    if (action === 'clear-zone') { state.points = []; drawZones(); return; }
    if (action === 'save-zone') { await post(base() + '/zones',{tableId:document.querySelector('[name=visionTable]').value,points:state.points}); toast('Zona guardada'); return await render('vision'); }
    if (action === 'delete-zone') { await request(base() + '/zones/' + id,{method:'DELETE'}); return await render('vision'); }
    if (action === 'observe') { const result = await post(base() + '/vision/observe',{tableId:document.querySelector('[name=visionTable]').value,action:id,frameIndex:state.frame}); document.querySelector('#observation').textContent = 'Observación demo: ' + result.observation.guests + ' comensales · ' + (result.observation.waiterPresent ? 'mesero presente' : result.observation.dishDelivered ? 'platillo entregado' : result.observation.secondsSinceService + ' s sin atención') + (result.result.unattended ? ' → Alerta enviada y mesa sin atender.' : ' → Mesa actualizada.'); return; }
    if (action === 'save-page') { await savePage(); return toast('Borrador guardado'); }
    if (action === 'publish-page') { await savePage(); await post(base() + '/page/publish'); toast('Página publicada. Ya aparece en el directorio público.'); return await render('page'); }
    if (action === 'preview-page') { const dlg = document.querySelector('#dialog'); dlg.innerHTML = '<h2>Vista previa del borrador</h2><iframe class="preview" sandbox="" title="Vista previa"></iframe>' + button('Cerrar','close-dialog'); dlg.querySelector('iframe').srcdoc = '<!doctype html><style>' + state.editor.getCss() + '</style>' + state.editor.getHtml(); dlg.showModal(); return; }
    if (action === 'restore-page') { const version = document.querySelector('[name=version]').value; if (!version) throw new Error('Selecciona una versión'); await post(base() + '/page/history/' + version + '/restore'); toast('Versión restaurada como borrador'); return await render('page'); }
  } catch(error) { toast(error.message,true); }
  finally { target.disabled = false; }
});
app.addEventListener('change', async event => {
  if (event.target.name === 'frame') { state.frame = Number(event.target.value); try { await loadFrame(); } catch(error) { toast(error.message,true); } }
  if (event.target.name === 'reservationDate') {
    const date = event.target.value; const list = state.data.reservations.filter(r => !date || new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City'}).format(new Date(r.startsAt)) === date);
    document.querySelector('#reservation-list').innerHTML = reservationRows(list);
  }
});
app.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]'); if (!form) return;
  event.preventDefault(); const input = Object.fromEntries(new FormData(form)); const type = form.dataset.form; const submit = form.querySelector('[type=submit],button:not([type])'); if (submit) submit.disabled = true;
  try {
    if (type === 'table') await request(base() + '/tables' + (state.editingTable ? '/' + state.editingTable : ''),{method:state.editingTable ? 'PATCH' : 'POST',body:JSON.stringify({...input,seats:Number(input.seats)})});
    if (type === 'order') { const items = state.data.orderProducts.map(p => ({productId:p.id,quantity:Number(input['qty_' + p.id])})).filter(l => l.quantity > 0); await post(base() + '/orders',{tableId:input.tableId,notes:input.notes,items}); }
    if (type === 'product') await request(base() + '/products' + (state.editingProduct ? '/' + state.editingProduct : ''),{method:state.editingProduct ? 'PATCH' : 'POST',body:JSON.stringify({name:input.name,category:input.category,description:input.description,priceCents:Math.round(Number(input.price)*100),active:true})});
    if (type === 'reservation') { if (!input.tableId) throw new Error('Consulta y selecciona una mesa disponible'); await post(base() + '/reservations',{...input,guests:Number(input.guests),consent:input.consent === 'on'}); }
    if (type === 'user') await post(base() + '/users',input);
    if (type === 'restaurant') { const r = await post('/api/restaurants',{...input,thresholdSeconds:Number(input.thresholdSeconds)}); state.rid = r.id; state.tab = 'settings'; document.querySelector('#dialog').close(); await loadShell(); toast('Restaurante creado. Agrega mesas, menú y gerente.'); return; }
    if (type === 'profile') { await request(base(),{method:'PATCH',body:JSON.stringify({...input,thresholdSeconds:Number(input.thresholdSeconds),active:input.active === 'on'})}); await loadShell(); toast('Configuración guardada'); return; }
    document.querySelector('#dialog').close(); toast('Cambios guardados'); await render(state.tab);
  } catch(error) { const target = form.querySelector('.form-error'); if (target) target.textContent = error.message; else toast(error.message,true); }
  finally { if (submit) submit.disabled = false; }
});
window.addEventListener('online', () => { if (state.session && state.offline) loadShell(); });
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (state.session) loadShell().catch(error => loginView(error.message)); else loginView();

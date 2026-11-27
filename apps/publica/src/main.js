import './styles.css';
const API = import.meta.env.VITE_BETA_API || 'http://127.0.0.1:3150';
const e = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format((value || 0)/100);
const when = value => new Date(value).toLocaleString('es-MX',{timeZone:'America/Mexico_City'});
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City'}).format(new Date());
let session; try { session = JSON.parse(localStorage.getItem('rp-customer')); } catch {}
const state = { session, restaurant:null, lastQuery:null };
const root = document.querySelector('#page');
async function request(path,options = {}) {
  let response;
  try { response = await fetch(API + path,{...options,headers:{'content-type':'application/json',...(state.session ? {authorization:'Bearer ' + state.session.accessToken} : {})}}); }
  catch { throw new Error('No se puede conectar. Revisa que la API esté activa.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Solicitud inválida');
  return result;
}
const post = (path,value = {}) => request(path,{method:'POST',body:JSON.stringify(value)});
const field = (label,name,value = '',type = 'text',attrs = '') => `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${attrs}></label>`;
const button = (label,action,id = '') => `<button type="button" data-action="${action}" data-id="${e(id)}">${label}</button>`;
function message(value,error = false) {
  const target = document.querySelector('#message'); target.textContent = value; target.className = error ? 'message error' : 'message';
}
function go(path) { history.pushState(null,'',path); render().catch(error => message(error.message,true)); window.scrollTo(0,0); }
function shell(content) {
  root.className = '';
  root.innerHTML = `<header class="public-header"><a data-link href="/" class="logo">Restaurant Platform</a><nav><a data-link href="/">Restaurantes</a><a data-link href="/cuenta">${state.session ? 'Mis reservas' : 'Entrar o registrarme'}</a><a href="http://127.0.0.1:5174" target="_blank" rel="noopener">Gestionar restaurante ↗</a></nav></header><div id="message" role="status"></div><main class="public-main">${content}</main><footer class="public-footer">Beta local · Reservas de prueba · Horario de Ciudad de México</footer>`;
}
async function render() {
  const path = location.pathname.split('/').filter(Boolean);
  if (!path.length) return directory();
  if (path[0] === 'cuenta') return account();
  if (path[0] === 'reserva') return confirmation(path[1]);
  return restaurantView(path[0]);
}
async function directory(filters = {}) {
  document.title = 'Descubre restaurantes · Restaurant Platform';
  const list = await request('/public/restaurants?' + new URLSearchParams(filters));
  shell(`<section class="intro"><span class="eyebrow">DESCUBRE · ELIGE · RESERVA</span><h1>Tu próxima mesa empieza aquí</h1><p>Consulta el menú y reserva en el restaurante que elijas.</p></section><form data-form="search" class="filters">${field('Nombre','q',filters.q)}${field('Ciudad','city',filters.city)}${field('Tipo de cocina','cuisine',filters.cuisine)}${field('Personas','guests',filters.guests || 2,'number','min="1" max="30"')}<button>Buscar restaurantes</button></form><section class="restaurant-grid">${list.length ? list.map(r => `<article class="restaurant-card"><span class="eyebrow">${e(r.cuisine)}</span><h2>${e(r.name)}</h2><p>${e(r.city)}</p><p>${e(r.description || 'Conoce nuestro menú y reserva una mesa.')}</p><a data-link class="primary" href="/${e(r.slug)}">Ver restaurante y reservar</a></article>`).join('') : '<p>No hay restaurantes publicados con esos filtros. Publica una página desde Gestión para verla aquí.</p>'}</section>`);
}
async function restaurantView(slug) {
  const restaurant = await request('/public/restaurants/' + encodeURIComponent(slug)); state.restaurant = restaurant;
  let page; try { page = await request('/public/restaurants/' + encodeURIComponent(slug) + '/page'); } catch {}
  document.title = restaurant.name + ' · ' + restaurant.city;
  let description = document.querySelector('meta[name=description]'); if (!description) { description = document.createElement('meta'); description.name = 'description'; document.head.append(description); } description.content = restaurant.description;
  document.querySelector('#restaurant-schema')?.remove(); const schema = document.createElement('script'); schema.id = 'restaurant-schema'; schema.type = 'application/ld+json'; schema.textContent = JSON.stringify({'@context':'https://schema.org','@type':'Restaurant',name:restaurant.name,address:restaurant.address,servesCuisine:restaurant.cuisine}); document.head.append(schema);
  shell(`<a data-link href="/">← Directorio</a><section class="restaurant-heading"><div><span class="eyebrow">${e(restaurant.cuisine)} · ${e(restaurant.city)}</span><h1>${e(restaurant.name)}</h1><p>${e(restaurant.description)}</p><p>${e(restaurant.address)} · ${e(restaurant.openingTime)} a ${e(restaurant.closingTime)}</p></div><a class="primary" href="#reservar">Reservar una mesa</a></section>${page ? '<iframe sandbox="" referrerpolicy="no-referrer" id="digital-page" class="digital-page" title="Página digital del restaurante"></iframe>' : '<p class="notice">El restaurante aún está preparando su página digital.</p>'}<div class="public-split"><section class="card"><h2>Menú</h2>${restaurant.menu.length ? restaurant.menu.map(p => `<article class="menu-item"><div><strong>${e(p.name)}</strong><small>${e(p.category)} · ${e(p.description)}</small></div><span>${money(p.priceCents)}</span></article>`).join('') : '<p>El menú estará disponible próximamente.</p>'}</section><section class="card" id="reservar"><h2>Reserva tu mesa</h2><p>Duración estimada: 90 minutos.</p><form data-form="reserve">${field('Fecha','date',today(),'date','required min="' + today() + '"')}${field('Hora','time','14:00','time','required step="1800"')}${field('Personas','guests',2,'number','min="1" max="30" required')}${button('Consultar disponibilidad','availability')}<label>Mesa disponible<select name="tableId" required><option value="">Primero consulta disponibilidad</option></select></label>${field('Tu nombre','name',state.session?.user.name || '','text','required')}${field('Correo de confirmación','email',state.session?.user.email || '','email','required')}<label class="consent"><input name="consent" type="checkbox" required> Acepto que se use mi nombre y correo para gestionar esta reserva.</label><small>En esta beta el correo se guarda en una bandeja demo; la confirmación y cancelación funcionan aquí.</small><button id="confirm-reservation" disabled>Confirmar reserva</button><p class="form-error" role="alert"></p></form></section></div>`);
  if (page) document.querySelector('#digital-page').srcdoc = '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + page.css + '</style></head><body>' + page.html + '</body></html>';
}
async function confirmation(id) {
  const token = new URLSearchParams(location.search).get('token') || '';
  const r = await request('/public/reservations/' + encodeURIComponent(id) + '?token=' + encodeURIComponent(token));
  document.title = 'Tu reserva · ' + r.restaurant.name;
  shell(`<section class="card confirmation"><span class="eyebrow">TU RESERVA</span><h1>${r.status === 'confirmed' ? 'Reserva confirmada' : r.status === 'cancelled' ? 'Reserva cancelada' : r.status === 'arrived' ? 'Llegada registrada' : 'Visita completada'}</h1><h2>${e(r.restaurant.name)}</h2><p>${e(r.name)} · ${r.guests} personas</p><p>${when(r.startsAt)} · ${e(r.tableLabel)}</p><p>Código: ${e(r.id)}</p><p>Guarda esta dirección para consultar o cancelar tu reserva. El gerente ya puede verla en su sistema.</p><p class="notice">Confirmación de correo en modo demo, sin envío externo.</p>${r.status === 'confirmed' ? button('Cancelar mi reserva','cancel-reservation',r.id) : ''}<p><a data-link href="/${e(r.restaurant.slug)}">Volver al restaurante</a></p></section>`);
}
async function account() {
  document.title = 'Mi cuenta · Restaurant Platform';
  if (!state.session) {
    shell(`<h1>Tu cuenta de cliente</h1><div class="public-split"><section class="card"><h2>Iniciar sesión</h2><form data-form="login">${field('Correo','email','cliente@demo.local','email','required')}${field('Contraseña','password','demo1234','password','required')}<button>Entrar</button><p class="form-error" role="alert"></p></form></section><section class="card"><h2>Crear cuenta</h2><form data-form="register">${field('Nombre','name','','text','required')}${field('Correo','email','','email','required')}${field('Contraseña','password','','password','minlength="8" required')}<button>Registrarme</button><p class="form-error" role="alert"></p></form></section></div>`); return;
  }
  try {
    const list = await request('/api/customer/reservations');
    shell(`<section class="row"><div><h1>Mis reservas</h1><p>${e(state.session.user.name)} · ${e(state.session.user.email)}</p></div>${button('Cerrar sesión','logout')}</section><section class="card">${list.length ? list.map(r => `<article class="reservation-row"><div><h2>${e(r.restaurant.name)}</h2><p>${when(r.startsAt)} · ${r.guests} personas · ${e(r.status)}</p></div><a data-link href="${e(new URL(r.confirmationUrl).pathname + new URL(r.confirmationUrl).search)}">Consultar reserva</a>${r.status === 'confirmed' ? button('Cancelar reserva','customer-cancel',r.id) : ''}</article>`).join('') : '<p>Tu próxima reserva aparecerá aquí. Las reservas hechas como invitado se consultan mediante el enlace de confirmación.</p>'}</section>`);
  } catch(error) { state.session = null; localStorage.removeItem('rp-customer'); await account(); message(error.message,true); }
}
root.addEventListener('click',async event => {
  const link = event.target.closest('a[data-link]'); if (link) { event.preventDefault(); return go(link.getAttribute('href')); }
  const target = event.target.closest('[data-action]'); if (!target) return;
  target.disabled = true;
  try {
    if (target.dataset.action === 'availability') {
      const form = target.closest('form'); const data = Object.fromEntries(new FormData(form)); const query = {date:data.date,time:data.time,guests:data.guests};
      const list = await request('/public/restaurants/' + state.restaurant.slug + '/availability?' + new URLSearchParams(query));
      form.querySelector('[name=tableId]').innerHTML = list.length ? list.map(t => '<option value="' + e(t.id) + '">' + e(t.label) + ' · ' + t.seats + ' personas</option>').join('') : '<option value="">Sin disponibilidad</option>';
      document.querySelector('#confirm-reservation').disabled = !list.length; state.lastQuery = JSON.stringify(query); message(list.length ? 'Elige una mesa y confirma tus datos.' : 'Prueba otra hora, fecha o cantidad de personas.'); return;
    }
    if (target.dataset.action === 'cancel-reservation') { await post('/public/reservations/' + target.dataset.id + '/cancel',{token:new URLSearchParams(location.search).get('token')}); await confirmation(target.dataset.id); message('Tu reserva fue cancelada.'); }
    if (target.dataset.action === 'customer-cancel') { await post('/api/customer/reservations/' + target.dataset.id + '/cancel'); await account(); message('Reserva cancelada.'); }
    if (target.dataset.action === 'logout') { await post('/api/auth/logout'); state.session = null; localStorage.removeItem('rp-customer'); await account(); }
  } catch(error) { message(error.message,true); }
  finally { target.disabled = false; }
});
root.addEventListener('change',event => {
  if (event.target.closest('[data-form=reserve]') && ['date','time','guests'].includes(event.target.name)) { document.querySelector('#confirm-reservation').disabled = true; document.querySelector('[name=tableId]').innerHTML = '<option value="">Vuelve a consultar disponibilidad</option>'; }
});
root.addEventListener('submit',async event => {
  const form = event.target.closest('[data-form]'); if (!form) return; event.preventDefault();
  const input = Object.fromEntries(new FormData(form)); const type = form.dataset.form; const submit = form.querySelector('button:not([type])'); if (submit) submit.disabled = true;
  try {
    if (type === 'search') return await directory(input);
    if (type === 'reserve') {
      const query = JSON.stringify({date:input.date,time:input.time,guests:input.guests});
      if (state.lastQuery !== query || !input.tableId) throw new Error('Consulta disponibilidad para ese horario.');
      const reservation = await post('/public/restaurants/' + state.restaurant.slug + '/reservations',{...input,guests:Number(input.guests),consent:input.consent === 'on'});
      return go(new URL(reservation.confirmationUrl).pathname + new URL(reservation.confirmationUrl).search);
    }
    if (type === 'login' || type === 'register') {
      const session = await post(type === 'login' ? '/api/auth/login' : '/api/auth/register',input);
      if (session.user.role !== 'customer') throw new Error('Esta sección es para clientes. El equipo entra en Gestión.');
      state.session = session; localStorage.setItem('rp-customer',JSON.stringify(session)); await account();
    }
  } catch(error) { const message = form.querySelector('.form-error'); if (message) message.textContent = error.message; else document.querySelector('#message').textContent = error.message; }
  finally { if (submit) submit.disabled = false; }
});
window.addEventListener('popstate',() => render().catch(error => { shell('<h1>No se pudo abrir esta página</h1><a data-link href="/">Volver al directorio</a>'); message(error.message,true); }));
render().catch(error => { shell('<h1>No se pudo abrir esta página</h1><a data-link href="/">Volver al directorio</a>'); message(error.message,true); });

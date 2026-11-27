const API = import.meta.env.VITE_BETA_API || 'http://127.0.0.1:3150';
const slug = location.pathname.split('/').filter(Boolean)[0] || 'casa-demo';
const root = document.querySelector('#page');
try {
  const response = await fetch(`${API}/public/restaurants/${encodeURIComponent(slug)}/page`);
  const page = await response.json();
  if (!response.ok) throw new Error(page.error || 'Página no encontrada');
  document.title = page.name;
  const style = document.createElement('style'); style.textContent = page.css; document.head.append(style);
  root.className = ''; root.innerHTML = page.html;
} catch (error) {
  root.className = 'missing'; root.innerHTML = `<div><h1>Página aún no publicada</h1><p>${error.message}</p></div>`;
}

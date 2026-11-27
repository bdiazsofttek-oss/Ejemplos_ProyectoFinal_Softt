import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const API = process.env.VITE_BETA_API || 'http://127.0.0.1:3150';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function publicPages() {
  function middleware(server, preview) {
    return async (req, res, next) => {
      if (req.method !== 'GET') return next();
      const path = new URL(req.url, 'http://127.0.0.1:5175').pathname;
      if (path !== '/sitemap.xml' && path !== '/' && !/^\/[a-z0-9-]+$/.test(path)) return next();
      if (['/cuenta', '/robots.txt'].includes(path)) return next();
      try {
        const response = await fetch(API + '/public/restaurants', { signal: AbortSignal.timeout(2000) });
        if (!response.ok) return next();
        const list = await response.json();
        if (path === '/sitemap.xml') {
          res.setHeader('content-type', 'application/xml; charset=utf-8');
          return res.end('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://127.0.0.1:5175/</loc></url>' + list.map(r => '<url><loc>http://127.0.0.1:5175/' + escape(r.slug) + '</loc></url>').join('') + '</urlset>');
        }
        let title = 'Restaurantes · Restaurant Platform'; let description = 'Descubre restaurantes y reserva tu mesa.'; let schema = '';
        let content = '<h1>Restaurantes</h1>' + list.map(r => '<article><h2><a href="/' + escape(r.slug) + '">' + escape(r.name) + '</a></h2><p>' + escape(r.city) + ' · ' + escape(r.cuisine) + '</p></article>').join('');
        if (path !== '/') {
          const r = list.find(r => '/' + r.slug === path); if (!r) return next();
          title = r.name + ' · ' + r.city; description = r.description;
          content = '<h1>' + escape(r.name) + '</h1><p>' + escape(r.description) + '</p><p>' + escape(r.city) + ' · ' + escape(r.address) + '</p><h2>Menú</h2>' + r.menu.map(p => '<p>' + escape(p.name) + ' · $' + (p.priceCents / 100).toFixed(2) + '</p>').join('') + '<a href="#reservar">Reservar una mesa</a>';
          schema = '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'Restaurant', name: r.name, address: r.address, servesCuisine: r.cuisine }).replace(/</g, '\\u003c') + '</script>';
        }
        let html = await readFile(resolve(import.meta.dirname, preview ? 'dist/index.html' : 'index.html'), 'utf8');
        html = html.replace(/<title>.*?<\/title>/, '<title>' + escape(title) + '</title>').replace('</head>', '<meta name="description" content="' + escape(description) + '">' + schema + '</head>').replace(/<main id="page"[^>]*>.*?<\/main>/s, '<main id="page">' + content + '</main>');
        if (!preview) html = await server.transformIndexHtml(path, html);
        res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html);
      } catch { next(); }
    };
  }
  return { name: 'beta-public-pages', configureServer(server) { server.middlewares.use(middleware(server, false)); }, configurePreviewServer(server) { server.middlewares.use(middleware(server, true)); } };
}

export default defineConfig({ plugins: [publicPages()] });

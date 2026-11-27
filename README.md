# Restaurant Platform — beta local

Plataforma para la operación de restaurantes, páginas digitales por restaurante y eventos de visión. La rama `master` contiene el prototipo beta; el plan completo está en [Plan.1.md](Plan.1.md).

## Ejecutar

Requiere Node.js 24 o superior y npm. Desde la raíz:

```powershell
npm run setup
npm start
```

- Gestión: http://127.0.0.1:5174
- Página pública: http://127.0.0.1:5175/casa-demo
- API: http://127.0.0.1:3150/health

Acceso de demostración: `admin@demo.local` / `demo1234`. Usa `Ctrl+C` para detener los tres servicios.

## Contenido

```text
apps/gestion/       Mesas, pedidos, alertas y editor GrapesJS
apps/publica/       Página digital publicada
services/api/      API local Node con SQLite
services/vision/   Adaptador de eventos de demostración
contracts/         Contrato HTTP y esquema de eventos
simulacion.1/      25 fotogramas de prueba
scripts/           Lanzador de la beta
```

La beta permite crear pedidos, consultar mesas y eventos, editar borradores y publicar una página digital. El adaptador de visión genera un evento de integración a partir de los fotogramas; la inferencia real con Grounding DINO y SAM 2 está pendiente. La migración a FastAPI/PostgreSQL y las aplicaciones Next.js siguen en el plan.

Los datos locales se guardan en `services/api/data/beta.sqlite` y se excluyen de Git.

## Verificar

```powershell
npm test
npm run build
npm run vision:demo
```

El último comando requiere que la API esté activa. Más detalles en [BETA.md](BETA.md).

## Código anterior

El POS anterior se retiró del árbol activo de `master`. Su código sigue en el historial de Git y en la rama `Sistema-de-gestion`. Los archivos retirados, incluidos datos y configuraciones locales, tienen una copia recuperable en `.beta-archive/legacy-20261127/`, ignorada por Git.

Se conserva la [licencia original](LICENSE).

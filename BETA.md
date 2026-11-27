# Restaurant Platform — beta local

La rama `master` contiene las carpetas de la beta. El código del POS anterior permanece en el historial de Git y en la rama `Sistema-de-gestion`; la copia local recuperable está en `.beta-archive/legacy-20261127/`, ignorada por Git.

## Incluido

- API SQL local en `services/api` con SQLite, sesión demo y aislamiento por restaurante.
- Plano de mesas, creación de pedidos y lista de comandas.
- Registro y visualización de eventos del servicio de visión.
- Editor GrapesJS con borrador, publicación y página pública.
- Contrato OpenAPI y esquema de eventos.
- Adaptador que recorre los fotogramas de `simulacion.1` sin fingir inferencia de IA.

## Inicio rápido

Requiere Node.js 24 o superior. Instala las dependencias desde la raíz:

```powershell
npm run setup
```

Después inicia todo con un solo comando:

```powershell
npm start
```

Presiona `Ctrl+C` para detener los tres servicios.

También puedes arrancarlos por separado en tres terminales desde la raíz del repositorio:

```powershell
cd services/api
npm start
```

```powershell
cd apps/gestion
npm run dev
```

```powershell
cd apps/publica
npm run dev
```

Después abre `http://localhost:5174` e inicia sesión con:

- Correo: `admin@demo.local`
- Contraseña: `demo1234`

La página publicada se muestra en `http://localhost:5175/casa-demo`.

## Visión de demostración

Con la API activa:

```powershell
cd services/vision
npm run demo
```

El adaptador registra un evento basado en el conjunto de fotogramas. La instalación de Python y la inferencia real de Grounding DINO + SAM 2 pertenecen a la siguiente iteración.

## Datos

SQLite crea `services/api/data/beta.sqlite`. Puede borrarse para reiniciar los datos de demostración. No se debe versionar.

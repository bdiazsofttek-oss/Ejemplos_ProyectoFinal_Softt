# Plan de desarrollo por área

Asumo que **Antigravity** es el IDE donde integran el código y **Neon** es la base de datos Postgres serverless. Si me equivoqué con alguno, avísame y ajusto.

## Decisiones acordadas

- La arquitectura nueva se construirá en carpetas separadas dentro del repositorio. `master` contendrá la beta; el POS anterior se conserva en el historial y en `Sistema-de-gestion` para trasladar funcionalidades gradualmente.
- La base de datos objetivo se mantiene en **SQL**, concretamente PostgreSQL en Neon, usando SQLAlchemy y migraciones con Alembic.
- La visión utilizará **Grounding DINO** para localizar por texto meseros, comensales, mesas y platillos, y **SAM/SAM 2** para obtener y seguir sus máscaras. Las reglas de negocio se calcularán a partir de estas detecciones, zonas y relaciones espaciales.
- El material inicial de evaluación está en `simulacion.1/simulacion/` y actualmente contiene 25 fotogramas JPEG numerados (`00000.jpg` a `00024.jpg`). Se usará como conjunto de prueba inicial y se ampliará cuando sea necesario para validar diferentes escenas, ángulos y condiciones.
- **GrapesJS** será el editor visual dentro del sistema de gestión. Cada cliente/restaurante podrá diseñar y publicar su propia página digital; la web pública renderizará únicamente la versión publicada.
- El despliegue en Neon, Render, Railway u otros proveedores se hará al final. Las primeras etapas deben funcionar localmente mediante configuración por variables de entorno y, cuando corresponda, Docker.
- Las ramas `vision-de-video` y `creacion-de-paginas` se usarán como referencias técnicas. Su código no se mezclará directamente con la rama principal sin una adaptación revisada a esta arquitectura.

## Estado de la beta 0.1 — 27 de noviembre de 2026

- [x] Carpetas nuevas creadas sin modificar el funcionamiento del POS existente.
- [x] Contrato OpenAPI y esquema de eventos iniciales.
- [x] API beta local con sesión de gerente, restaurantes, mesas, pedidos, páginas digitales y eventos de visión.
- [x] Persistencia SQL local con SQLite y aislamiento por `restaurant_id` en las operaciones implementadas.
- [x] Interfaz de gestión con plano de mesas, pedidos, alertas y editor GrapesJS.
- [x] Guardado de borrador, validación de contenido, publicación y renderizado de la página pública.
- [x] Adaptador de integración que recorre los 25 fotogramas de `simulacion.1` y emite un evento explícitamente marcado como demostración sin inferencia.
- [ ] Sustituir el puente beta Node/SQLite por FastAPI/PostgreSQL manteniendo el mismo contrato.
- [ ] Instalar el runtime de visión y ejecutar inferencia real con Grounding DINO + SAM 2.
- [ ] Añadir autenticación de producción, reservas, cocina, WebSockets, PWA offline y pruebas de navegador.

La implementación beta y sus instrucciones de inicio están documentadas en `BETA.md`.

### Limpieza de master — 27 de noviembre de 2026

Se retiraron del árbol activo el POS anterior, sus servicios auxiliares, migraciones, documentación, automatizaciones y configuración de construcción. Se conservaron las apps y servicios beta, contratos, lanzador, plan, licencia, los 25 fotogramas originales y los datos SQL de la beta. Los archivos retirados tienen una copia local recuperable en `.beta-archive/legacy-20261127/`, excluida de Git. Los comandos de la raíz ejecutan exclusivamente la beta.

## Estructura del repositorio

### Entrega beta funcional 0.2

Se añadieron las áreas y el flujo de prueba conectado: administración y roles por restaurante, mesas/menú/equipo, pedidos, cocina, entrega, cuenta/cobro de prueba, disponibilidad y reservas públicas/internas, llegada y cancelación, cuenta de cliente, editor con vista previa/historial/publicación, zonas y fuente de video, simulación guiada de visión, alertas WebSocket, reportes, bandeja demo de correo, plano offline y SEO público básico. Las reglas se ejecutan en la API SQL y las migraciones locales son aditivas.

La inferencia DINO/SAM, el correo externo, la infraestructura objetivo FastAPI/PostgreSQL/Next.js y el despliegue siguen pendientes. La beta no los presenta como ejecutados. El recorrido, accesos y límites están en `BETA.md`.

Un monorepo para que Codex, Antigravity y Neon trabajen sobre la misma base:

```
restaurante-plataforma/
├── contracts/            # Owner: Manuel. Contratos compartidos
│   ├── openapi.yaml      # API REST
│   ├── events.schema.json  # Eventos de video y de pedidos
│   └── README.md
├── services/
│   ├── api/              # Owner: Manuel. Backend + BD + auth
│   └── vision/           # Owner: Manuel. Análisis de video
├── apps/
│   ├── gestion/          # Owner: Brandon. PWA del restaurante
│   └── publica/          # Owner: Angel y Luis. Web pública
└── docs/                 # Decisiones de arquitectura
```

**Regla central:** cada Codex solo modifica su carpeta. Lo que cruza fronteras pasa por `contracts/`, y ese archivo solo lo cambia Manuel, previo aviso al resto.

## Tecnologías por área

**Área 1: Video, backend y BD (Manuel)**
- Visión: Python, OpenCV, Grounding DINO para detección guiada por texto y SAM/SAM 2 para segmentación y seguimiento de meseros, comensales, mesas y platillos. Reglas de zona y relaciones espaciales con Shapely. Se evaluará un tracker adicional solo si SAM 2 no mantiene identidades con suficiente estabilidad.
- API: FastAPI con Pydantic. Documentación OpenAPI generada automáticamente.
- BD: PostgreSQL en Neon, migraciones con Alembic, SQLAlchemy como ORM.
- Tiempo real: WebSockets para alertas a la PWA.
- Auth: JWT con roles (`platform_admin`, `gerente`, `mesero`, `cocina`) y aislamiento por `restaurant_id`.
- Ejecución inicial: API y servicio de visión en entorno local (o en una laptop para la demo). El despliegue de API y BD se deja para la etapa final.

**Área 2: Sistema de gestión (Brandon)**
- Next.js con React y TypeScript.
- Tailwind CSS y shadcn/ui para componentes.
- PWA con Serwist (instalable, con caché offline para el plano de mesas).
- TanStack Query para datos del servidor y Zustand para estado local.
- Cliente WebSocket para alertas en vivo.
- Cliente de API generado desde `contracts/openapi.yaml`.
- GrapesJS integrado como editor visual de la página digital de cada restaurante, con borrador, vista previa y publicación.

**Áreas 3 y 4: Web pública (Angel y Luis)**
- Next.js con renderizado en servidor (SSR) para que Google indexe el directorio.
- Tailwind CSS y shadcn/ui, compartiendo el sistema de diseño con la PWA.
- Búsqueda y filtros por ciudad, tipo de cocina y número de personas.
- Correos de confirmación con Resend.
- Cliente de API generado desde `contracts/openapi.yaml`.
- Renderizado seguro de las páginas digitales publicadas desde GrapesJS, aisladas por `restaurant_id` y con una ruta o subdominio estable por restaurante.

## Transversalidad por área

Cada área se responsabiliza de lo siguiente dentro de su sección:

| Tema | Manuel | Brandon | Angel y Luis |
|---|---|---|---|
| Seguridad | Auth, roles, validación en API, secretos | Protección de rutas, sesión segura | Protección de formularios, rate limiting de reservas, sin datos sensibles expuestos |
| Pruebas | Unitarias de reglas de atención y API | Pruebas de componentes y de flujos clave | Pruebas de búsqueda y de reserva |
| Privacidad | No guardar video, retención de eventos | No mostrar datos de clientes innecesarios | Consentimiento en formulario de reserva |
| Documentación | README y contratos | README y guía de uso | README y guía de contenido |
| Observabilidad | Logs y métricas de visión | Errores de cliente | Errores y analítica básica |

## Contratos compartidos

Lo que hay que definir antes de la semana 2 para que las áreas no se bloqueen:

- **Endpoints de reservas:** disponibilidad, crear, cancelar, consultar.
- **Endpoints de pedidos y mesas:** estado de mesa, crear pedido, cambiar estado.
- **Evento de mesa desatendida:** `mesa_id`, `restaurant_id`, `desde`, `duracion_seg`, `severidad`.
- **Restaurantes públicos:** nombre, ubicación, tipo de cocina, horarios.
- **Errores:** formato único para todas las respuestas de error.

## Checklists de funcionalidades

### Área 1: Video, backend y BD (Manuel)

**Visión**
- [ ] Captura de video desde archivo o cámara IP
- [ ] Carga reproducible de los fotogramas de `simulacion.1/simulacion/`
- [ ] Calibración de zonas por mesa (polígonos guardados por restaurante)
- [ ] Detección guiada con Grounding DINO de meseros, comensales, mesas y platillos
- [ ] Segmentación y seguimiento de instancias con SAM/SAM 2 entre cuadros
- [ ] Clasificación operacional de meseros y comensales con reglas configurables y validación sobre el material de simulación
- [ ] Regla de mesa desatendida con umbral configurable
- [ ] Envío de eventos a la API
- [ ] Modo demo con video grabado

**Backend**
- [ ] Autenticación y roles
- [ ] CRUD de restaurantes, mesas, zonas, productos y menú
- [ ] Pedidos y cambios de estado
- [ ] Reservas: disponibilidad, crear, cancelar, marcar llegada
- [ ] Endpoints públicos de directorio y disponibilidad
- [ ] WebSockets para alertas
- [ ] Reportes básicos de ocupación y tiempos
- [ ] Persistencia de páginas digitales por restaurante: borrador, versión publicada y metadatos
- [ ] Sanitización y validación del contenido generado antes de publicarlo

**BD y transversal**
- [ ] Esquema con `restaurant_id` en todas las tablas
- [ ] Migraciones versionadas
- [ ] Datos semilla para la demo
- [ ] Pruebas de reglas de atención
- [ ] Despliegue de la API y de la BD en Neon

### Área 2: Sistema de gestión PWA (Brandon)

- [ ] Login y redirección por rol
- [ ] Plano de mesas con estado en vivo (libre, ocupada, pidió, cuenta, sin atender)
- [ ] Alertas de mesa desatendida con sonido y vibración
- [ ] Toma de pedidos por mesa
- [ ] Vista de cocina con comandas
- [ ] Reservas internas: lista del día, confirmar, cancelar, marcar llegada
- [ ] Reportes básicos de ocupación
- [ ] PWA instalable con modo offline del plano de mesas
- [ ] Diseño responsivo para tablet y celular
- [ ] Editor GrapesJS para crear la página digital del restaurante
- [ ] Guardado de borradores, vista previa, historial básico y publicación
- [ ] Pruebas de flujos principales

### Áreas 3 y 4: Web pública (Angel y Luis)

- [ ] Página de inicio y búsqueda
- [ ] Directorio de restaurantes con filtros
- [ ] Página de cada restaurante con información y menú
- [ ] Renderizado de la página digital publicada por cada restaurante
- [ ] Disponibilidad por fecha, hora y número de personas
- [ ] Flujo de reserva en una mesa libre
- [ ] Confirmación por correo
- [ ] Registro e inicio de sesión opcional para ver reservas
- [ ] SEO: metadatos, sitemap y datos estructurados por restaurante
- [ ] Pruebas de búsqueda y reserva

## Cronograma sugerido (12 a 14 semanas)

- **Semana 1:** arquitectura nueva en carpetas separadas, contratos, esquema SQL y diseño de pantallas, manteniendo operativo el POS actual.
- **Semanas 2 a 4:** API con autenticación, CRUD base, plano de mesas en PWA y directorio en web pública.
- **Semanas 5 a 8:** pedidos, reservas, detección con Grounding DINO + SAM/SAM 2, editor GrapesJS y alertas en vivo.
- **Semanas 9 a 11:** integración de los tres frentes, flujos completos y pruebas.
- **Semanas 12 a 14:** datos de demo, ajustes, documentación, despliegue y presentación.

**Hito de integración:** semana 6. A partir de aquí, cada área prueba contra la API real y no contra mocks.

---

## README para Codex: Área 1 (Manuel), `services/` y `contracts/`

```markdown
# Área 1: Video, API y Base de Datos

## Responsable
Manuel. Eres el único dueño de `services/api/`, `services/vision/` y `contracts/`.

## Objetivo
Construir el servicio de análisis de video que detecta mesas desatendidas, la API REST que usan todas las apps y el esquema de base de datos en Neon.

## Alcance
- `services/vision/`: detección guiada con Grounding DINO, segmentación y seguimiento con SAM/SAM 2, zonas por mesa y reglas de atención.
- `services/api/`: FastAPI, autenticación, roles, reservas, pedidos, mesas, páginas digitales, directorio público y WebSockets.
- `services/api/migrations/`: migraciones con Alembic.
- `contracts/`: OpenAPI y esquemas de eventos.

## Stack
- Python 3.12, FastAPI, Pydantic, SQLAlchemy, Alembic
- PostgreSQL en Neon
- OpenCV, Grounding DINO, SAM/SAM 2 y Shapely
- pytest para pruebas

## Reglas para el agente
1. No modifiques `apps/`. Si una app necesita un cambio, documéntalo en `contracts/CHANGELOG.md`.
2. Todo endpoint debe existir en `contracts/openapi.yaml` antes de implementarse.
3. Toda tabla lleva `restaurant_id` y las consultas deben filtrar por él.
4. El video nunca se guarda ni se envía a la nube; solo se envían eventos.
5. Las contraseñas se guardan con hash. Nunca se escriben secretos en el código.
6. Cada regla de negocio nueva lleva pruebas.
7. Usa `simulacion.1/simulacion/` como entrada reproducible inicial y registra las métricas de cada evaluación.

## Checklist de terminado
- [ ] Autenticación con roles funcionando
- [ ] CRUD de restaurantes, mesas, zonas, productos
- [ ] Pedidos y reservas con sus endpoints
- [ ] Endpoints públicos de directorio y disponibilidad
- [ ] WebSockets para alertas
- [ ] Detección y segmentación de meseros, comensales, mesas y platillos
- [ ] Detección de mesa desatendida con umbral configurable
- [ ] Persistencia y publicación segura de páginas digitales por restaurante
- [ ] Migraciones aplicadas en Neon
- [ ] Datos semilla para demo
- [ ] Pruebas pasando en CI

## Contratos que produce
- `contracts/openapi.yaml`
- `contracts/events.schema.json`

## Definición de "hecho"
Un endpoint está hecho cuando tiene contrato, implementación, pruebas y migración si aplica.
```

## README para Codex: Área 2 (Brandon), `apps/gestion/`

```markdown
# Área 2: Sistema de Gestión (PWA)

## Responsable
Brandon. Eres el dueño de `apps/gestion/`.

## Objetivo
PWA instalable para gerentes, meseros y cocina, con plano de mesas en vivo, pedidos, reservas internas y alertas de mesas desatendidas.

## Alcance
- Login y rutas protegidas por rol
- Plano de mesas con estado en tiempo real
- Toma de pedidos y vista de cocina
- Reservas internas del día
- Alertas con sonido y vibración
- Modo offline del plano de mesas
- Diseño responsivo para tablet y celular
- Editor visual de la página digital del restaurante, con borrador, vista previa y publicación

## Stack
- Next.js con TypeScript
- Tailwind CSS y shadcn/ui
- Serwist para PWA y caché offline
- TanStack Query y Zustand
- Cliente de API generado desde `contracts/openapi.yaml`
- Cliente WebSocket para alertas
- GrapesJS para el editor de páginas digitales
- Vitest y Playwright para pruebas

## Reglas para el agente
1. Solo modifica `apps/gestion/`. No toques `services/` ni `apps/publica/`.
2. Consume la API únicamente a través del cliente generado desde `contracts/openapi.yaml`.
3. No inventes endpoints. Si falta uno, pídelo a Manuel en `contracts/CHANGELOG.md`.
4. Protege todas las rutas según el rol del usuario.
5. No muestres datos de clientes más allá de lo necesario para la operación.
6. Usa los componentes del sistema de diseño compartido en `apps/publica/` como referencia, sin importarlos directamente.
7. El contenido de GrapesJS debe guardarse por `restaurant_id`; nunca publiques HTML o CSS sin pasar por la validación y sanitización definidas por la API.

## Checklist de terminado
- [ ] Login y redirección por rol
- [ ] Plano de mesas con estados en vivo
- [ ] Alertas de mesa desatendida con sonido y vibración
- [ ] Toma de pedidos y vista de cocina
- [ ] Reservas internas: lista, confirmar, cancelar, marcar llegada
- [ ] Reportes básicos de ocupación
- [ ] PWA instalable
- [ ] Modo offline del plano de mesas
- [ ] Editor GrapesJS con borrador, vista previa y publicación
- [ ] Pruebas de flujos principales

## Contratos que consume
- `contracts/openapi.yaml`
- `contracts/events.schema.json`

## Definición de "hecho"
Una pantalla está hecha cuando funciona contra la API real en el hito de integración, es responsiva y tiene pruebas de su flujo principal.
```

## README para Codex: Áreas 3 y 4 (Angel y Luis), `apps/publica/`

```markdown
# Áreas 3 y 4: Web Pública

## Responsables
Angel y Luis. Son los dueños de `apps/publica/`. Dividan el trabajo así: Angel toma directorio, páginas de restaurante y SEO; Luis toma búsqueda, disponibilidad, reservas y cuentas de cliente.

## Objetivo
Sitio público donde cualquier persona descubre restaurantes, consulta disponibilidad y reserva una mesa libre.

## Alcance
- Inicio y búsqueda
- Directorio con filtros por ciudad, tipo de cocina y número de personas
- Página de cada restaurante con información y menú
- Renderizado de la página digital que el restaurante haya publicado desde GrapesJS
- Disponibilidad por fecha, hora y personas
- Flujo de reserva y confirmación por correo
- Registro e inicio de sesión opcional para ver reservas
- SEO: metadatos, sitemap, datos estructurados

## Stack
- Next.js con TypeScript y renderizado en servidor
- Tailwind CSS y shadcn/ui
- Resend para correos
- TanStack Query para datos del cliente
- Cliente de API generado desde `contracts/openapi.yaml`
- Vitest y Playwright para pruebas

## Reglas para el agente
1. Solo modifica `apps/publica/`. No toques `services/` ni `apps/gestion/`.
2. Consume solo endpoints públicos o de cliente definidos en `contracts/openapi.yaml`.
3. Las páginas de restaurante deben renderizarse en servidor para que Google las indexe.
4. El formulario de reserva debe incluir aviso de privacidad y consentimiento.
5. Aplica límite de intentos en reservas y en inicio de sesión.
6. Nunca muestres en la web pública información interna del restaurante, como pedidos o estado de mesas en vivo.
7. Renderiza únicamente versiones publicadas y sanitizadas; los borradores solo son visibles en la vista previa autenticada.

## Checklist de terminado
- [ ] Inicio y búsqueda
- [ ] Directorio con filtros
- [ ] Página de restaurante con SEO
- [ ] Página digital personalizada y publicada por el restaurante
- [ ] Disponibilidad por fecha, hora y personas
- [ ] Flujo de reserva completo
- [ ] Confirmación por correo
- [ ] Registro e inicio de sesión opcional
- [ ] Sitemap y datos estructurados
- [ ] Pruebas de búsqueda y reserva

## Contratos que consume
- `contracts/openapi.yaml` (solo endpoints públicos y de cliente)

## Definición de "hecho"
Una página está hecha cuando se renderiza en servidor, funciona contra la API real y tiene pruebas de su flujo principal.
```

---

## Dos puntos a acordar antes de arrancar

1. **Quién decide sobre `contracts/`.** Propongo que Manuel sea el único que lo modifica, pero que Brandon, Angel y Luis puedan proponer cambios en `contracts/CHANGELOG.md`. Así evitan conflictos.
2. **Quién integra.** Propongo que Manuel coordine la integración en el hito de la semana 6, porque es el dueño del contrato y de la base de datos.

Si me dices la fecha límite exacta, puedo convertir este cronograma en fechas concretas.

# Contratos de la plataforma

Esta carpeta es la frontera estable entre las aplicaciones y los servicios nuevos.

- `openapi.yaml`: contrato HTTP de la beta.
- `events.schema.json`: eventos producidos por el servicio de visión.

La implementación beta de `services/api` usa Node y SQLite para poder ejecutarse en el entorno actual sin instalar Python ni Docker. Las rutas y modelos se conservarán al migrar el servicio a FastAPI y PostgreSQL/Neon. `openapi.yaml` utiliza sintaxis JSON, válida en YAML 1.2, y también se sirve en `/openapi.json`.

Las sesiones se envían como `Authorization: Bearer <token>`. El ámbito del restaurante proviene de la sesión y se valida contra la ruta; los clientes no tienen acceso al área operativa.

El WebSocket `/ws` recibe como primer mensaje `{ "token": "...", "restaurantId": "..." }`. Responde `connected` y emite `changed` con `entity`, `restaurantId` y `at` para invalidar las consultas de esa sesión. No distribuye datos de otros restaurantes ni permite acciones de negocio mediante el socket.

# Contratos de la plataforma

Esta carpeta es la frontera estable entre las aplicaciones y los servicios nuevos.

- `openapi.yaml`: contrato HTTP de la beta.
- `events.schema.json`: eventos producidos por el servicio de visión.

La implementación beta de `services/api` usa Node y SQLite para poder ejecutarse en el entorno actual sin instalar Python ni Docker. Las rutas y modelos se conservarán al migrar el servicio a FastAPI y PostgreSQL/Neon.

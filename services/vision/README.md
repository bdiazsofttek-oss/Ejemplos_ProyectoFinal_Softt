# Servicio de visión — beta

La beta valida la integración con la API recorriendo los 25 fotogramas de `simulacion.1/simulacion/` y generando un resumen de prueba. No afirma que haya ejecutado inferencia real.

La siguiente iteración instalará Python, Grounding DINO y SAM 2, descargará pesos versionados fuera de Git y sustituirá el adaptador de demostración por inferencia real. La salida mantendrá el esquema de `contracts/events.schema.json`, por lo que la PWA y la API no tendrán que cambiar.

Con la API iniciada:

```powershell
npm run demo
```

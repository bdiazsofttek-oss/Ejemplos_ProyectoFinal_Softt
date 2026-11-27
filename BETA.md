# Restaurant Platform — beta funcional 0.2

La rama `master` contiene las carpetas de la beta. El código del POS anterior permanece en el historial de Git y en la rama `Sistema-de-gestion`; la copia local recuperable está en `.beta-archive/legacy-20261127/`, ignorada por Git.

## Incluido

- API SQL local con SQLite, sesiones con vencimiento, contraseñas con hash, roles y aislamiento por restaurante.
- Administración de restaurantes, perfil público, horarios, mesas, menú y equipo.
- Pedidos con productos y precios del servidor: nuevo → preparando → listo → entregado → pagado.
- Cocina conectada a pedidos, solicitud de cuenta, cobro local de prueba y liberación de mesas.
- Directorio público con filtros, menú, disponibilidad y reservas sin solapamientos.
- Reservas de clientes e internas, confirmación, cancelación, llegada y visita completada.
- Cuenta de cliente para consultar y cancelar sus propias reservas.
- Fotogramas, zonas dibujables por mesa, fuentes de video y simulación guiada de comensales, espera, atención y entrega de platillos.
- Alertas, reconocimiento, actualizaciones WebSocket, sonido activable y reportes básicos.
- Editor GrapesJS con borrador, vista previa aislada, publicación e historial restaurable.
- PWA con último plano disponible sin conexión; las escrituras requieren conexión.
- Perfil y menú públicos renderizados también en servidor, metadatos y sitemap.
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

`npm start` compila y abre las versiones de prueba de las dos apps; este modo permite probar la PWA. `npm run dev` inicia el desarrollo con recarga automática.

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

Después abre `http://127.0.0.1:5174`. Todos los accesos demo usan la contraseña `demo1234`:

- Gerente: `admin@demo.local`
- Mesero: `mesero@demo.local`
- Cocina: `cocina@demo.local`
- Administrador de plataforma: `plataforma@demo.local`
- Cliente en el sitio público: `cliente@demo.local`

El directorio está en `http://127.0.0.1:5175`. La página de demostración está en `/casa-demo`; publica el borrador desde Gestión para que aparezca en el directorio.

## Recorrido completo para probar

1. Entra como gerente y revisa Configuración, Mesas, Menú y Equipo. El administrador de plataforma puede crear y seleccionar otros restaurantes; agrega su gerente desde Equipo.
2. En Página digital, edita con GrapesJS, guarda, abre la vista previa y publica. El historial permite recuperar una versión como borrador.
3. Abre el directorio público, busca el restaurante, consulta el menú y elige fecha, hora y personas. Consulta disponibilidad, selecciona mesa, acepta el uso de datos y confirma.
4. La confirmación tiene un enlace privado de consulta y cancelación. La reserva aparece en Gestión y el correo en Correos demo. Una cuenta de cliente permite ver sus propias reservas.
5. Para probar la llegada, reserva dentro de los próximos 90 minutos y del horario de apertura. En Reservas marca la llegada; la mesa se ocupa. También puedes ocupar una mesa libre directamente.
6. Abre la mesa y toma un pedido del menú. En Cocina pasa por Preparar y Listo para entregar. Como mesero o gerente márcalo entregado. Solicita la cuenta y registra el cobro para liberar la mesa.
7. En Visión y zonas, selecciona mesa y fotograma. Dibuja al menos tres puntos y guarda la zona. Usa Llegan comensales → Espera sin atención → Mesero atiende para ver cambios de mesa y alertas. La espera simula el paso del umbral configurado.
8. Consulta Reportes. Para probar el plano offline, abre Mesas usando `npm start`, espera la activación de la PWA y desconecta la red. Podrás consultar el último plano, sin realizar cambios.

Las reservas duran 90 minutos y utilizan el horario de Ciudad de México. Los estados de cocina y disponibilidad se validan en la API.

## Visión de demostración

Con la API activa:

```powershell
cd services/vision
npm run demo
```

El adaptador registra un evento basado en el conjunto de fotogramas. La instalación de Python y la inferencia real de Grounding DINO + SAM 2 pertenecen a la siguiente iteración.

La pantalla de visión permite abrir un video local en el navegador sin subirlo al servidor y guardar una fuente de cámara. La reproducción HTTP/MJPEG depende del formato y acceso de la cámara; RTSP y el análisis automático requieren el adaptador pendiente.

## Límites explícitos de esta entrega

- Visión: observaciones guiadas por botones, sin inferencia real DINO/SAM.
- Correo: bandeja local demo, sin envío por Resend.
- Cobro: registro local de efectivo de prueba, sin pasarela de pagos.
- Infraestructura: Node/SQLite y Vite como puente beta. FastAPI, PostgreSQL/Neon y Next.js continúan en el plan; el despliegue se hará al final.

## Pruebas

```powershell
npm test
npm ci
npm run test:e2e
```

Las pruebas de API cubren reglas, permisos, reservas, cocina, cobro, visión y publicación. Las pruebas de navegador usan Microsoft Edge instalado y una base en memoria; requieren libres los puertos 3150, 5174 y 5175. No escriben en tu base SQLite.

## Datos

SQLite crea `services/api/data/beta.sqlite`. Puede borrarse para reiniciar los datos de demostración. No se debe versionar.

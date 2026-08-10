# Plan del proyecto — Gestión Logística

## Contexto

Sistema de logística para una empresa venezolana que vende **helados y pizzas
congeladas**, cubriendo Ventas, Inventario, Despachos, Aprobación de
despachos, Flota de vehículos y Seguimiento con mapas.

- **Stack**: Next.js (App Router, TypeScript) + shadcn/ui en el frontend;
  backend **FastAPI (Python)** real sobre **PostgreSQL** (acceso con
  `psycopg` + SQL plano, sin ORM — ver `prisma/schema.prisma`); Prisma se
  usa como fuente de verdad del modelo de datos y para generar el cliente
  JS/migraciones, no para el acceso a datos en Python.
- **Estilo visual**: paleta clara y cálida inspirada en heladerías
  venezolanas (crema + rojo-naranja + amarillo), sidebar agrupado por
  módulos, wizards con tarjetas numeradas.
- **Estado actual**: **App completa y conectada de punta a punta** — los 8
  módulos leen y escriben datos reales en Postgres via la API FastAPI.
  Postgres sigue **local** por ahora (se migra a la nube más adelante);
  sembrada con datos de ejemplo para demostración (ver
  [`backend/app/seed.py`](../backend/app/seed.py)).

## Arquitectura

```
Next.js (puerto 3000)  <-- fetch -->  FastAPI (puerto 8000)  <-- psycopg -->  Postgres (local)
```

- **Lecturas**: cada página (Server Component) hace `fetch` server-side a la
  API vía la capa de selectores en
  [`src/lib/mock-data/index.ts`](../src/lib/mock-data/index.ts) (mismo
  nombre de carpeta por historia — ya no son datos mock, son wrappers de
  `fetch`; ver `src/lib/api-client.ts`). La lógica de *unir* venta+cliente+
  items+producto vive en TypeScript (reutilizada tal cual de Fase 1); la API
  solo devuelve filas planas por tabla.
- **Escrituras**: los formularios/botones (crear venta, aprobar/rechazar,
  agregar vehículo/usuario, calcular ruta, asignar vehículo) llaman la API
  directo desde el navegador (Client Components) — por eso FastAPI tiene
  CORS habilitado para `localhost:3000`.
- **Correr todo**: `npm run dev:all` (o `npm run dev` + `npm run dev:api` en
  dos terminales). Ver [`backend/README.md`](../backend/README.md).

## Módulos — todos con lectura y escritura reales

| Módulo | Rutas | Qué hace |
|---|---|---|
| **Dashboard** | `/` | KPIs, ventas recientes, mini-mapa de despachos en tránsito — todo desde Postgres |
| **Ventas** | `/ventas`, `/ventas/nueva`, `/ventas/[id]`, `/ventas/revision`, `/ventas/revision/[id]` | Crear venta real (`POST /ventas`): si el cliente tiene facturas `PENDIENTE`/`VENCIDA` en la base → `EN_REVISION`, si no → `APROBADA` automática, con la tasa BCV real del día. Aprobar/rechazar en revisión persiste (`POST /ventas/{id}/revision`) |
| **Inventario** | `/inventario`, `/inventario/categorias`, `/inventario/[id]` | Catálogo y stock reales, precios en USD y Bs |
| **Despachos** | `/despachos`, `/despachos/nuevo`, `/despachos/[id]`, `/despachos/aprobacion`, `/despachos/aprobacion/[id]` | `POST /despachos` genera un despacho real desde una venta aprobada, sugiriendo por producto `cantidad = min(solicitado, stock disponible)`; el coordinador puede ajustarla a mano (`PATCH /despachos/{id}/items/{itemId}`) antes de que salga del almacén. Aprobar/rechazar (`POST /despachos/{id}/aprobacion`) independiente de la revisión de venta |
| **Ruta óptima + sugerencia de vehículo** | dentro de `/despachos/[id]` | "Calcular ruta óptima" previsualiza con la lógica portada de `network_analysis/page_1`; "Confirmar ruta" persiste de verdad (`POST /despachos/{id}/ruta`, guarda `RutaPunto`). Sugerencia de vehículo y "Asignar" reales (`GET`/`POST /despachos/{id}/vehiculos-sugeridos`, `/asignar-vehiculo`) |
| **Flota** | `/flota`, `/flota/[id]` | "Agregar vehículo" (`POST /vehiculos`) y cambio de estado (`PATCH /vehiculos/{id}/estado`) persisten |
| **Seguimiento** | `/seguimiento`, `/seguimiento/[id]` | Mapa con despachos `APROBADO`/`EN_TRANSITO` (aprobados listos para salir + en camino), línea de tiempo desde `RutaPunto` |
| **Despachador** | `/despachador`, `/despachador/[id]` | Vista dedicada para el chofer: sus despachos `APROBADO`/`EN_TRANSITO`, mapa grande con la ruta real, botones "Salí del almacén" (`POST /despachos/{id}/iniciar`) y "Marcar como entregado" (`POST /despachos/{id}/entregar`) |
| **Usuarios** | `/usuarios` | "Agregar usuario" (`POST /usuarios`) persiste |

## Historial de decisiones y correcciones

1. **Paleta clara estilo heladería venezolana**, manteniendo la distribución
   de la referencia "Centinela".
2. **Flujo de dos aprobaciones independientes**: revisión de venta por
   facturas pendientes (`VentaRevision`) y aprobación de despacho
   (`DespachoAprobacion`), procesos separados — confirmado con el negocio.
3. **`Cliente.codigo` como llave primaria** del cliente.
4. **Flota propia** (no de los clientes) con sugerencia de vehículo por
   capacidad/refrigeración/disponibilidad.
5. **Roadmap de TSP**: el análisis de ruta empieza simple (origen→destino);
   la optimización multi-parada (TSP) queda documentada como pendiente, no
   descartada (ver `services/route_analysis.py`).
6. **Despachos nacen de ventas aprobadas** — sin carga manual de productos;
   el wizard elige una venta aprobada sin despacho y toma sus datos.
7. **Un solo almacén** (Almacén Catia, Caracas), con coordenadas reales.
8. **Doble moneda USD/Bs** en todos los precios; `tasaBcv` se congela por
   venta/factura al momento de registrarse (no cambia con la fluctuación del
   bolívar), usando la tasa real más reciente de `TasaCambio`.
9. **Modelo de datos ampliado**: `TasaCambio` (histórico), campos de pago
   opcionales + `pagoAprobado` en `Factura`. Se confirmó que NO se necesita
   peso real por producto ni devoluciones/notas de crédito por ahora. Ver
   [`docs/MODELO_DATOS.md`](./MODELO_DATOS.md#decisiones-confirmadas).
10. **Sync diario real de la tasa BCV** — `backend/app/jobs/sync_tasa_bcv.py`
    consulta [dolarapi.com](https://ve.dolarapi.com/v1/dolares/oficial) y
    hace upsert en `TasaCambio`, disparado por una Tarea Programada de
    Windows a las 6:00pm. Ver
    [`backend/app/jobs/README.md`](../backend/app/jobs/README.md).
11. **API FastAPI completa** (no solo tasa BCV): 9 routers, ~29 endpoints,
    lectura y escritura real para los 8 módulos. Acceso a datos con
    `psycopg` + SQL plano en vez de `prisma-client-py` — ese paquete de
    terceros trae un motor que todavía exige la URL dentro de
    `schema.prisma`, algo que Prisma 7 ya no permite (se movió a
    `prisma.config.ts`); incompatibilidad real descubierta al implementar,
    documentada junto al `generator client` en `prisma/schema.prisma`.
12. **Datos de ejemplo sembrados en Postgres** para poder hacer una demo en
    vivo: `backend/app/seed.py` lee `backend/app/seed_data.json` (generado
    una única vez a partir de los antiguos arrays mock de
    `src/lib/mock-data/*.ts`, que ahora son wrappers de `fetch`) y hace
    `TRUNCATE`+`INSERT`. **Nunca toca `TasaCambio`** — esa tabla ya tenía
    datos reales del sync diario y no se quería perder esa información
    (usa `ON CONFLICT (fecha) DO NOTHING` para las filas históricas mock).
    Después de la demo, `python -m app.seed --reset` vacía todo lo demás.
13. **Selección de vehículo/venta ya no depende de arrays en memoria**: la
    capa `src/lib/mock-data/index.ts` mantiene los mismos nombres de función
    de Fase 1 (`getVentaConDetalle`, `getDespachosPendientesAprobacion`,
    etc.) pero ahora son `async` y hacen `fetch` a la API — el resto del
    código (páginas, componentes) casi no tuvo que cambiar su lógica, solo
    agregar `await`.
14. **Una venta nueva se bloquea (409) si el cliente tiene un ciclo abierto**:
    se detectó que un cliente podía acumular ventas `APROBADA` sin límite
    aunque la anterior no se hubiera entregado. Ahora `POST /ventas` revisa
    si el cliente tiene una `Venta` `APROBADA` cuyo `Despacho` (si existe) no
    esté en `ENTREGADO`/`RECHAZADO`, y si es así rechaza la venta nueva hasta
    que ese ciclo se cierre. Ver `backend/app/api/ventas.py`.
15. **Módulo Despachador + cierre real del ciclo del despacho**: antes nada
    transicionaba un despacho de `APROBADO` a `EN_TRANSITO`/`ENTREGADO`, por
    lo que Seguimiento nunca mostraba despachos recién aprobados y el ciclo
    de la venta jamás se cerraba. Se agregaron `POST /despachos/{id}/iniciar`
    (`APROBADO`→`EN_TRANSITO`) y `POST /despachos/{id}/entregar`
    (`EN_TRANSITO`→`ENTREGADO`, también marca el último `RutaPunto` como
    `entregado`), expuestos en el nuevo módulo `/despachador` para que el
    chofer los dispare. Seguimiento se actualizó para mostrar
    `APROBADO`+`EN_TRANSITO` (antes solo `EN_TRANSITO`/`EN_PREPARACION`, un
    estado que nunca se usaba).
16. **Mapas: `fitBounds` real en vez de `zoom` fijo adivinado** — el zoom
    fijo hacía que rutas medianas/largas se dibujaran fuera del contenedor
    visible. `src/components/map/leaflet-map.tsx` ahora acepta un prop
    `bounds` y encuadra todos los puntos automáticamente (con reintento si el
    contenedor todavía mide cero al montar). También se corrigió
    `RouteOptimizerSection` para restaurar la ruta ya persistida de un
    despacho (antes solo reconocía 2 despachos de ejemplo de Fase 1 via un
    diccionario mock).
17. **Corrección de un error de hidratación global de React** — `useIsMobile`
    (`src/hooks/use-mobile.ts`) evaluaba `window.innerWidth` en el render
    inicial, que nunca coincide entre servidor y cliente; como
    `SidebarProvider` lo usa en el layout compartido, rompía la hidratación
    en todas las páginas en producción. Se reemplazó por
    `useSyncExternalStore`, el patrón que React recomienda para esto.
18. **Ventas: no se bloquean por falta de stock, a propósito** — se detectó
    que se podía vender más cantidad de la que hay en inventario. En vez de
    bloquear (lo que ocultaría la demanda real del cliente), la venta sigue
    registrando lo pedido tal cual, y el modelo ahora distingue "lo
    solicitado" de "lo realmente despachable": `DespachoItem` guarda
    `cantidadSolicitada` (congelado desde la venta) y `cantidad` (sugerida
    como `min(solicitado, stock)` al generar el despacho, ajustable a mano
    por el coordinador hasta que sale del almacén). El stock se descuenta de
    verdad recién en `POST /despachos/{id}/iniciar`. `Nueva venta` muestra el
    stock disponible por producto y un aviso no bloqueante si se supera. La
    brecha resultante (solicitado − despachado) es la señal para decidir en
    qué productos vale la pena invertir más inventario. Ver
    [`docs/MODELO_DATOS.md`](./MODELO_DATOS.md#decisiones-confirmadas).

## Modelo de datos

Ver [`docs/MODELO_DATOS.md`](./MODELO_DATOS.md) para el detalle de entidades,
relaciones y diagrama ER. Fuente técnica: [`prisma/schema.prisma`](../prisma/schema.prisma).
Fuente técnica de la API: [`backend/README.md`](../backend/README.md).

## Fuera de alcance (todavía)

- Autenticación/login real y control de permisos por rol — las acciones usan
  el usuario mock fijo del topbar (`usuarioActual`).
- Conexión real a un SuperMap iServer para el cálculo de rutas (sigue siendo
  una síntesis mock en `backend/app/services/route_analysis.py`, aunque ya
  persiste de verdad).
- Análisis TSP multi-parada (roadmap, no descartado).
- Migrar la Postgres local a un servidor en la nube.
- UI para registrar/aprobar pagos de factura (los campos existen en el
  modelo y se muestran como badge informativo, pero no hay formulario para
  cargarlos).
- Regenerar `backend/app/seed_data.json` — el script que lo generaba ya no
  puede correr (ver nota en `backend/README.md`); el JSON se mantiene como
  snapshot fijo de los datos de la demo.

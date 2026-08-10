# Plan del proyecto — Gestión Logística

## Contexto

Sistema de logística para una empresa venezolana que vende **helados y pizzas
congeladas**, cubriendo Ventas, Inventario, Despachos, Aprobación de
despachos, Flota de vehículos y Seguimiento con mapas.

- **Stack**: Next.js (App Router, TypeScript) + shadcn/ui + Prisma en el
  frontend; backend FastAPI (Python) planeado para Fase 2; PostgreSQL como
  base de datos.
- **Estilo visual**: paleta clara y cálida inspirada en heladerías
  venezolanas (crema + rojo-naranja + amarillo), sidebar agrupado por
  módulos, wizards con tarjetas numeradas.
- **Estado actual**: **Fase 1 completa** (UI sobre datos mock) + primera
  pieza real de Fase 2 en marcha: sync diario de la tasa BCV contra una
  Postgres local (ver más abajo). El resto de la app sigue en mock — el
  frontend Next.js todavía no lee de esta base de datos.

## Módulos construidos

| Módulo | Rutas | Qué hace |
|---|---|---|
| **Dashboard** | `/` | KPIs (ventas del día, en revisión, stock bajo, despachos por aprobar/en tránsito, vehículos disponibles), ventas recientes, mini-mapa de despachos en tránsito |
| **Ventas** | `/ventas`, `/ventas/nueva`, `/ventas/[id]`, `/ventas/revision`, `/ventas/revision/[id]` | Alta de ventas con detección automática de facturas pendientes → aprobación directa o cola de revisión; aprobar/rechazar con comentario |
| **Inventario** | `/inventario`, `/inventario/categorias`, `/inventario/[id]` | Catálogo, filtros por categoría/stock bajo, stock por almacén, precios en USD y Bs |
| **Despachos** | `/despachos`, `/despachos/nuevo`, `/despachos/[id]`, `/despachos/aprobacion`, `/despachos/aprobacion/[id]` | Los despachos se generan **a partir de una venta aprobada** (wizard de 2 pasos: elegir venta → confirmar); aprobación de despacho independiente de la revisión de venta, con acciones inline en la lista |
| **Ruta óptima + sugerencia de vehículo** | dentro de `/despachos/[id]` | Botón "Calcular ruta óptima" (mock, portado de la lógica de `network_analysis/page_1`) + ranking de vehículos sugeridos por capacidad/refrigeración |
| **Flota** | `/flota`, `/flota/[id]` | Vehículos propios de la empresa, cambio de estado, modal "Agregar vehículo" |
| **Seguimiento** | `/seguimiento`, `/seguimiento/[id]` | Mapa con despachos activos (click-to-fly-to), detalle con polyline + línea de tiempo |
| **Usuarios** | `/usuarios` | Listado, modal "Agregar usuario" |

## Historial de decisiones y correcciones (sobre el plan original)

El plan original (ver `prisma/schema.prisma` y el historial de conversación)
se ajustó varias veces con feedback del negocio:

1. **Paleta clara estilo heladería venezolana** en vez de tema oscuro,
   manteniendo la distribución de la referencia "Centinela".
2. **Flujo de dos aprobaciones independientes**: revisión de venta por
   facturas pendientes (`VentaRevision`) y aprobación de despacho
   (`DespachoAprobacion`) son procesos separados.
3. **Cliente.codigo como llave primaria** del cliente.
4. **Flota propia** (no de los clientes) con sugerencia automática de
   vehículo por capacidad/refrigeración/disponibilidad.
5. **Roadmap de TSP**: el análisis de ruta empieza simple (origen→destino);
   la optimización multi-parada (TSP) se documentó como pendiente, no
   descartada.
6. **Despachos nacen de ventas aprobadas** — se eliminó la carga manual de
   productos en el wizard; ahora se elige una venta aprobada sin despacho y
   se toman sus productos/cliente automáticamente.
7. **Un solo almacén** (Almacén Catia, Caracas) — se consolidaron los 4
   almacenes de ejemplo en uno solo, con coordenadas reales.
8. **Doble moneda USD/Bs** en todos los precios, usando una tasa BCV mock
   (`TASA_BCV_VES_POR_USD` en `src/lib/constants.ts`).
9. **Altas de Vehículo y Usuario vía modal** — se agregaron a la sesión del
   navegador (no persisten al recargar, ya que no hay backend todavía).
10. Corrección de bugs de UX: botón de eliminar producto en "Nueva venta" que
    quedaba deshabilitado silenciosamente; falta de botones de
    aprobar/rechazar en la lista de aprobación de despachos.
11. **Altas rápidas con modal**: "Agregar vehículo" y "Agregar usuario" desde
    un modal pequeño, con los datos mínimos necesarios.
12. **Modelo de datos analizado y ampliado** — tras revisar el modelo con el
    negocio se agregó `TasaCambio` (histórico de tasa BCV por fecha) con
    `tasaBcv` congelada en `Venta`/`Factura` (para que el Bs histórico no
    cambie con la fluctuación del bolívar, mostrando siempre ambas monedas),
    y campos de pago opcionales + `pagoAprobado` en `Factura`. Se confirmó
    que NO se necesita peso real por producto (el promedio por categoría
    alcanza) ni devoluciones/notas de crédito por ahora. Ver
    [`docs/MODELO_DATOS.md`](./MODELO_DATOS.md#decisiones-confirmadas).
13. **Sync diario real de la tasa BCV** — primera pieza de Fase 2, aislada
    del resto de la app (que sigue en mock). Un script Python
    (`backend/app/jobs/sync_tasa_bcv.py`) consulta
    [dolarapi.com](https://ve.dolarapi.com/v1/dolares/oficial) y hace upsert
    en `TasaCambio` sobre una Postgres **local** (se migrará a la nube más
    adelante), disparado por una Tarea Programada de Windows a las 6:00pm.
    Acceso a datos con `psycopg` + SQL plano en vez de `prisma-client-py`:
    ese paquete de terceros trae un motor que todavía exige la URL dentro de
    `schema.prisma`, algo que Prisma 7 ya no permite (se movió a
    `prisma.config.ts`) — incompatibilidad real descubierta al implementar,
    documentada junto al `generator client` en `prisma/schema.prisma`. Ver
    [`backend/app/jobs/README.md`](../backend/app/jobs/README.md) para el
    setup y la operación día a día.

## Modelo de datos

Ver [`docs/MODELO_DATOS.md`](./MODELO_DATOS.md) para el detalle de entidades,
relaciones y diagrama ER. Fuente técnica: [`prisma/schema.prisma`](../prisma/schema.prisma).

## Fuera de alcance de la Fase 1 (pendiente para Fase 2)

- Backend FastAPI real (endpoints, lógica de negocio).
- Autenticación y control de permisos por rol.
- Conexión real a PostgreSQL (`prisma migrate`/`db push`).
- Verificación real de facturas pendientes contra base de datos.
- Conexión real a un SuperMap iServer para el cálculo de rutas
  (`NETWORK_ANALYST_URL` en `.env.example`).
- Algoritmo real de sugerencia de vehículos (hoy es un ranking mock).
- Análisis TSP multi-parada (roadmap, no descartado).
- Tasa de cambio BCV real (hoy es una constante fija).
- Persistencia de las altas hechas desde los modales de Vehículo/Usuario.
- Conectar el frontend Next.js a leer `TasaCambio` en vivo desde Postgres
  (hoy el sync ya corre y escribe en la DB local, pero la UI sigue usando
  `src/lib/mock-data/tasas-cambio.ts`).
- Migrar la Postgres local del sync de tasa BCV a un servidor en la nube.
- UI para registrar/aprobar pagos de factura (hoy los campos existen en el
  modelo y se muestran como badge informativo, pero no hay formulario para
  cargarlos).

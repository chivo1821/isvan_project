@AGENTS.md

# Contexto (quién y para qué)

- **Desarrollador:** Gustavo. Estudia contabilidad y programación por su
  cuenta; trabaja en la empresa **Sirumatek**, en el **departamento de GIS**.
  Desarrolla este sistema junto con un **socio**.
- **Origen del proyecto:** TRALOG (distribuidora de helados y pizzas
  congeladas, junto con ISVAN operan desde el Almacén Catia) enviaba sus
  datos de ventas para hacerles análisis y tableros. La primera idea era
  Power BI, pero Gustavo y su socio decidieron **construir los indicadores
  como módulo propio dentro de esta web**, pensando en **revender el sistema
  a otros clientes**. Esa decisión es la razón de ser de todo el proyecto.
- **Base técnica:** la experiencia GIS de Sirumatek (SuperMap iServer/
  iDesktopX, PostGIS, redes viales) explica por qué las rutas se calculan
  con **PostGIS + pgRouting sobre la red vial propia** en vez de pagar un
  servicio externo. En otros equipos de Sirumatek hay proyectos hermanos de
  GIS (catastro 3D, división político-territorial en PostgreSQL, Vividime).
- **Restricción de costos:** el despliegue usa el **plan gratis de Vercel**,
  así que cada cambio debe cuidar el consumo de CPU (ver la rama
  `fix/cpu-despachador`: pool de conexiones, enlaces sin precarga, menos
  sondeos del Seguimiento y endpoints que devuelven solo lo necesario).

# Pendientes (al 2026-11-17)

## Costo histórico por fila de venta (rama `feature/costo-historico`)

Pedido del cliente (2026-11-18): que una lista de precios nueva NO recalcule
el costo de los meses cerrados. Antes el margen histórico se calculaba siempre
con el costo vigente del producto.

- **Hecho (2026-11-18, sin commit):**
  - `Venta.costoCajaUsd` nuevo (migración
    `20261118120000_costo_historico_venta`, ya aplicada en la base local).
  - `confirmar_carga` sella en cada fila el costo vigente al confirmar.
  - Consultas (`indicadores_venta.SUMAS` y `productos_del_periodo`;
    `gastos.py` las hereda): `COALESCE(v."costoCajaUsd", vp."costoCajaUsd")`
    — las filas viejas sin sello se comportan exactamente como antes.
  - `backend/scripts/sellar_costos_historicos.py`: backfill idempotente que
    reproduce la línea de tiempo (cargas + listas en orden de subida).
    Resultado en local: 34.266 filas selladas, 2.865 sin costo (productos
    que nunca tuvieron costo cargado), márgenes por mes idénticos a antes
    (en la base local los costos nunca cambiaron entre cargas).
  - Pruebas nuevas: `backend/tests/` (conftest con base desechable +
    `test_costo_historico.py`, 6 OK). Ojo: pytest se instaló en el venv pero
    NO está en requirements.txt.
  - Parser de listas (`ventas_import.py`): acepta la lista oficial de Tío
    Rico (hoja "Tralog", encabezados con saltos de línea). El costo se toma
    de "Precio Caja Distribuidores" — NUNCA de "Precio Caja $. Cliente",
    que es el precio al cliente final (confirmado con el cliente el
    2026-11-18).
  - Tercer formato soportado (2026-11-18): la exportación con "Precio Un
    Distribuidores" (precio por UNIDAD, no por caja). El parser lo marca con
    `ListaPrecios.precio_por_unidad=True` y la API
    (`_normalizar_a_costo_por_caja` en `indicadores.py`) lo convierte a
    costo por caja multiplicando por `unidadesPorCaja` conocida en ventas;
    lo que no tiene conversión va a `descartadas` (nunca se inventa un
    factor). Verificado con la lista real: los 36 productos convertidos
    cuadraron al centavo con la misma lista en formato por caja.
- **Prueba en vivo con la lista real (noviembre 2026, 37 productos):** 36
  cambiaron de costo (aumentos de 25–50 %, una rebaja), 1 producto nuevo.
  Los meses cerrados NO se movieron; la única variación (jun–sep) vino de
  1.714 filas de 11 productos que NUNCA habían tenido costo y ahora estiman
  con el vigente — el mismo comportamiento que tenía el sistema viejo, y se
  siguen reportando en "venta sin costo" hasta tener dato de su época.
- **Pase a producción, EN ESTE ORDEN:**
  1. `prisma migrate deploy` contra Neon (columna aditiva; el código viejo
     la ignora, así que va ANTES del deploy).
  2. Merge a develop + push (Vercel despliega el backend nuevo).
  3. Backfill contra Neon: `sellar_costos_historicos.py --dry-run` primero y
     luego real, con `--database-url` apuntando a Neon.
  4. Verificar en producción los indicadores de un par de meses antes y
     después del backfill (no deberían moverse si no hubo cambio de lista).


## Fix de CPU en Vercel — TERMINADO (2026-11-17)

Vercel avisó de consumo de CPU del plan gratis (2026-11-12/16).

- **Commit `1da623f`:** enlaces sin precarga (`@/components/shared/enlace`
  en vez de `next/link`) y Seguimiento sondeando cada 30 s.
- **Commit `07f113e` (unido a develop y empujado a origin el 2026-11-17):**
  - `backend/app/core/db.py` con **pool de conexiones** (`psycopg_pool`,
    máx. 8, cierra la ociosa al minuto; antes cada llamada abría 2
    conexiones con su TLS completo). `requirements.txt`:
    `psycopg[binary,pool]`.
  - Endpoints nuevos en `backend/app/api/rutas.py`:
    `GET /rutas/activas/con-relaciones` y `GET /rutas/{id}/con-relaciones`
    (esquema `RutasConRelaciones` en `schemas.py`), respetando los permisos
    por rol.
  - Front (`src/lib/mock-data/`): `getRutasActivas()` de 7 llamadas a 1 y
    `getRutaConDetalle()` de 5 a 1.
- **Ensayo en vivo (2026-11-17, aprobado):** probado en la carpeta principal
  puesta en `develop`. Endpoints verificados con sesión real: activas → 16
  rutas + 196 clientes + 9 usuarios + 9 vehículos en 1 llamada; detalle de
  la R-0029 → 1 ruta con trazado y solo sus relaciones (4 clientes,
  3 usuarios, 1 vehículo). Seguimiento, detalle de ruta, Despachador y
  Dashboard renderizan completos. Las páginas son server components: el
  navegador solo sondea `/rutas/seguimiento/version` cada 30 s.
- **Falta:** vigilar el consumo de CPU en Vercel los próximos días. Cuando
  se confirme la bajada se puede borrar la rama `fix/cpu-despachador` y su
  worktree `../gestion_logistica_fix`.

## Próximo paso: una sola rama con `administrativo` + `feature/app-movil`

Objetivo: ver la web con los cambios visuales del sistema administrativo (el
menú por áreas) junto con todo lo de la app móvil, y desde ahí empezar a
probar el sistema administrativo.

### Estado de las ramas

- **`feature/app-movil`** (sale de develop `a9193be`): **todo sin commit** —
  desde el 2026-11-17 la carpeta principal está en `develop` y este trabajo
  está guardado en `git stash` como `app-movil-wip` (para retomarlo:
  `git checkout feature/app-movil` + `git stash pop`).
  - Backend: sesión Bearer para la app (`core/auth.py`, `api/auth.py`),
    `api/movil.py` y `services/jornadas.py` (jornada y posiciones),
    seguimiento en vivo en `api/rutas.py` (`/seguimiento/repartidores`,
    `/seguimiento/sin-senal`, `ultima` en el recorrido), no entregados
    (`services/reversos.py`, `no_entregados_de`) y el delivery atribuido por
    jornada (`services/delivery.py`).
  - Web: Seguimiento con la posición real y el detalle con línea de tiempo;
    aviso desplegable «dejaron de enviar su ubicación»
    (`aviso-sin-senal.tsx`, cerrado por defecto); número ámbar junto a
    Seguimiento en el menú; paradas no entregadas en rojo con «Motivo»;
    cerrar sesiones móviles desde Usuarios.
  - Migraciones nuevas: `20261110120000_app_movil`,
    `20261110120100_marcas_ubicacion` y `20261112120000_reverso_orden`.
    Están aplicadas solo en la base local; en Neon las aplica el usuario.
- **`administrativo`** (worktree `../gestion_logistica_admin`, base local
  `gestion_logistica_admin`, puertos 3001/8001, `npm run dev:admin`):
  - Commits: 7b11282, 511d03b, 1182755, 166005e, cd49520, y e23812d (merge de
    develop hasta 141a491; le falta a9193be, el filtro por ruta del Resumen).
  - **Sin commit:** el menú por áreas (`src/lib/navegacion.ts`,
    `pestanas-area.tsx`, `buscador-pantallas.tsx` y cambios en
    `(dashboard)/layout.tsx`, `app-sidebar.tsx` y `topbar.tsx`). Es una
    propuesta que el usuario todavía no aprobó.

### Pasos (preguntar antes de cada commit)

1. Commit de `feature/app-movil`.
2. Commit del menú por áreas en `administrativo`.
3. Rama de integración (por ejemplo `integracion/admin-app`) desde
   `administrativo`, y unirle develop y `feature/app-movil`.
4. Conflictos esperables:
   - `app-sidebar.tsx`: el número de «sin señal» tiene que pasar al menú por
     áreas (Logística → Seguimiento, en `navegacion.ts`).
   - `prisma/schema.prisma` y el orden de las migraciones (las del
     administrativo son del 2026-11-06/07; las de la app, del 2026-11-10/12).
   - `backend/app/main.py` (routers), `core/auth.py` (Bearer con
     `requiere_permiso`) y Usuarios.
   - **Precarga de enlaces:** develop ya tiene `1da623f` (aviso de CPU de
     Vercel del 2026-11-12), que cambia `next/link` por
     `@/components/shared/enlace`, que no precarga. Al traer develop, todo
     archivo nuevo de las dos ramas tiene que usar ese `Link`
     (`git grep '"next/link"' -- src` debe dar solo `enlace.tsx`). El número de «sin señal» del menú pregunta cada 60 s en
     todas las pantallas: revisar si conviene espaciarlo, por la CPU de Vercel.
5. Aplicar las migraciones de la app en la base `gestion_logistica_admin`.
   Correr `backend/tests` (26 OK en administrativo) y las pruebas de la app:
   `test_app_movil.py` 40 OK, `test_no_entregados.py` 19 OK,
   `test_pago_parcial.py` y `test_anular_excluir.py`.
6. Revisarlo en el navegador (escritorio y teléfono) antes de pensar en
   develop.

**Ojo:** las pruebas de la app, `migrar_local.py`, `dev_partes.mjs` y
`sesion_prueba.py` viven en el scratchpad temporal de la sesión del
2026-11-12 y pueden perderse. Conviene pasarlas a `backend/tests/` al
integrar.

## Para empezar a probar el sistema administrativo

- Se enciende con `NEXT_PUBLIC_MODULO_ADMINISTRATIVO=1`, sobre la base
  `gestion_logistica_admin`, con el emisor fiscal SIMULADO (sin
  `EMISOR_FISCAL` no se emite).
- **Falta:**
  - módulos del vendedor en la app (venta con inventario y demanda no
    atendida, fase 1.7 / B2);
  - RLS;
  - una segunda fuente para la tasa BCV;
  - PDF fiscal (lo da la imprenta);
  - frenar un extracto que se cruce con lo ya facturado;
  - integrar una imprenta digital real;
  - unir a develop con todo apagado por interruptor.
- **Antes de cualquier vista previa en Vercel:** crear la rama `staging` de
  Neon. Hoy Preview usa la misma `DATABASE_URL` que producción. Lo configura
  el usuario.
- Confirmar en Vercel Production `CRON_SECRET`, `COOKIE_SECURE` y
  `RESEND_API_KEY`: sin `CRON_SECRET`, el cron de la tasa responde 503.

## App móvil (en pausa)

Carpeta real `C:\glm` (junction `../gestion_logistica_movil`), repo propio,
**sin commit**.

- **Hecho:**
  - despachador completo: jornada con ubicación en segundo plano, rutas,
    marcas sin señal y estado de cuenta;
  - mapa con Leaflet + OpenStreetMap (Google Cloud no funciona en Venezuela);
  - entrar con la huella;
  - Configuración (engranaje) con la versión.
- **Pendiente:**
  - actualizaciones sin reinstalar (expo-updates);
  - aviso en la app de los huecos de ubicación («tu teléfono cerró la app de
    tal a tal hora»), solo si el usuario lo aprueba;
  - ícono y logo del cliente;
  - llave de firma de entrega y paquete definitivo (hoy
    `com.gestionlogistica.campo`);
  - dirección https de producción;
  - entorno de prueba para usarla en la calle sin cable;
  - módulos del vendedor.
- **Teléfonos Tecno, Infinix e Itel (HiOS):** cierran la app al deslizarla y
  la congelan en segundo plano, y la ubicación se corta. Hacen falta los
  ajustes de batería, pero el usuario **no quiere tocar todavía** la ayuda de
  batería.
- **Dato de prueba en la base local:** la R-0029 quedó asignada a la moto
  JYFFFUF para probar el mapa.

# Backend — API FastAPI

API real del sistema (rutas, despachos, clientes, flota, seguimiento,
usuarios/login) sobre PostgreSQL. Acceso a datos con `psycopg` + SQL plano
contra las tablas que `prisma/schema.prisma` crea vía `migrate` — sin ORM
Python (ver la nota junto al `generator client` en ese archivo sobre por
qué no se usó `prisma-client-py`).

El frontend (`..`) consume esta API — ver [`src/lib/api-client.ts`](../src/lib/api-client.ts)
y la capa de selectores en [`src/lib/mock-data/index.ts`](../src/lib/mock-data/index.ts)
(el nombre de la carpeta es historia — hoy son wrappers de `fetch`, no datos mock).

Pasos de instalación y despliegue: ver el [README principal](../README.md).

## Estructura

```
backend/
  app/
    main.py              # FastAPI app, CORS, sesion global, incluye los routers
    schemas.py            # modelos Pydantic (request/response)
    core/
      db.py                # get_connection() — psycopg + DATABASE_URL
      auth.py              # hash/verificacion de password, sesiones, get_current_user, requiere_rol
      permisos.py          # "solo puede ver lo suyo": filtra por vehiculo asignado al rol REPARTIDOR
      excel_utils.py       # helpers compartidos para parsear los Excel de importacion
      numero.py            # siguiente numero secuencial (D-0001, R-0001)
    services/
      route_analysis.py    # ruta real (FindPath) y multi-parada (TSP) via SuperMap iServer, con fallback sintetico
      suggest_vehiculo.py  # sugerencia de vehiculo por capacidad/refrigeracion
      plan_rutas.py        # sugerencia de como agrupar despachos en viajes (ruta comercial + capacidad + cercania + costo)
    api/
      auth.py       almacenes.py   clientes.py     despachos.py
      historial.py  reportes.py    rutas.py        usuarios.py     vehiculos.py
    seed.py               # siembra Postgres con datos de ejemplo (opcional, ver README principal)
    seed_data.json
  requirements.txt
```

## Módulos de la API

| Router | Qué hace |
|---|---|
| `auth.py` | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` — sesión por cookie httpOnly (ver `core/auth.py`) |
| `usuarios.py` | Listar/crear usuarios (solo ADMIN), autoservicio de cambio de contraseña, reseteo por ADMIN, asignación del vehículo de un repartidor (`PATCH /{id}/vehiculo`) |
| `clientes.py` | CRUD de clientes por empresa (ISVAN/TRALOG), carga individual y masiva por Excel (`/importar/preview`, `/importar/confirmar`, `/importar/plantilla`) |
| `despachos.py` | Creación manual o por Excel (`/importar/preview`, `/importar/confirmar`), aprobación, ajuste de cantidades por ítem |
| `rutas.py` | Sugiere cómo agrupar los despachos aprobados en viajes (`POST /rutas/sugerencias`), arma la ruta multi-parada elegida (TSP contra SuperMap iServer), la recalcula, inicia el viaje y marca entregas por parada |
| `vehiculos.py` | CRUD de flota |
| `almacenes.py` | Listado (hoy un único almacén, Catia) |
| `reportes.py` | Descargas en Excel (`/reportes/clientes.xlsx`, `/despachos.xlsx`, `/rutas.xlsx`) para gestión — no accesibles a un REPARTIDOR |
| `historial.py` | Aprobaciones de despacho y puntos de ruta, sin filtrar (el frontend filtra) |

Todos los routers salvo `auth` exigen sesión válida (dependencia global en
`main.py`); varias acciones además exigen un rol específico (`requiere_rol`
en cada endpoint — ver la tabla de permisos en `docs/PLAN.md`).

## Correr el servidor

Desde la raíz del proyecto:

```bash
npm run dev:api
```

Equivalente manual: `backend\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --app-dir backend`.

Swagger interactivo en `http://localhost:8000/docs`.

Para frontend + backend juntos: `npm run dev:all` desde la raíz (ver README
principal). Para cerrar todo: `npm run stop` (cierra por puerto 3000/8000,
con respaldo por si `uvicorn --reload` deja un proceso hijo huérfano en
Windows — ver [`scripts/stop-dev.ps1`](../scripts/stop-dev.ps1)).

## Análisis de rutas (SuperMap iServer)

`services/route_analysis.py` calcula la ruta real contra el servicio de
Transportation Analyst de SuperMap iServer si `NETWORK_ANALYST_URL` está
configurado (ver `.env.example`):

- **Tramo simple** (`FindPath`, `.../path.json`) para origen→destino.
- **Multi-parada** (`FindTSPPaths`, `.../tsppath.json`) para una Ruta con
  varios despachos: el orden de visita real lo decide el servicio
  (`stopIndexes` en la respuesta), no una heurística local.

El proxy de ambos servicios solo acepta `GET`, así que los parámetros
(`nodes`, `parameter`) van serializados como JSON en la query string en vez
de un body `POST`. Si el servicio no está configurado, no responde, o no
encuentra un camino entre los puntos, cada uno cae automáticamente a un
fallback (ruta sintética / heurística de vecino más cercano encadenando
tramos) para que la app nunca se rompa por esto.

## Sugerencia de agrupación de rutas

`services/plan_rutas.py` responde `POST /rutas/sugerencias`: propone qué
despachos meter en cada vehículo **sin persistir nada**. Agrupa por
**cercanía entre clientes** (criterio principal: una parada no entra si se
sale del radio permitido, `RADIO_MAX_ENTRE_PARADAS_KM`, ajustable con
`radioMaxKm` en el request), respetando capacidad y cadena de frío del
vehículo; la ruta comercial del cliente (`Cliente.rutaComercial`) solo
desempata entre paradas igual de cerca — como factor sobre la distancia, no
como km sumados — o pasa a restricción dura si se pide. Además
estima km/tiempo/costo de cada viaje. Las distancias de esta etapa son
estimadas (Haversine × factor de vialidad) porque son decenas de
combinaciones; el trazado real se calcula una sola vez al crear la ruta con
`POST /rutas`. Las constantes ajustables (penalización, tope de paradas,
costo por km de referencia) están al inicio del módulo.

## Carga de Excel

Tanto despachos (`/despachos/importar/*`) como clientes
(`/clientes/importar/*`) siguen el mismo flujo de dos fases: `preview`
valida el archivo completo y devuelve filas válidas + errores (fila,
columna, motivo) sin escribir nada; `confirmar` crea todo en una sola
transacción. `core/excel_utils.py` tiene la normalización de encabezados
(flexible a variaciones de nombre/acentos) compartida por ambos.

Ambos importadores reconocen una columna opcional `ruta` (alias: `zona`,
`cod ruta`, `ruta comercial`…) con la **ruta comercial** del cliente. El
extracto de ventas es la fuente de verdad: al confirmar una importación de
despachos, esa ruta se guarda en la ficha del cliente.

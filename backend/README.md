# Backend — API FastAPI

API real del sistema (ventas, inventario, despachos, aprobaciones, flota,
tasa BCV) sobre PostgreSQL. Acceso a datos con `psycopg` + SQL plano contra
las tablas que `prisma/schema.prisma` crea via `migrate` — sin ORM Python
(ver la nota junto al `generator client` en ese archivo sobre por qué no se
usó `prisma-client-py`).

El frontend (`..`) consume esta API — ver [`src/lib/api-client.ts`](../src/lib/api-client.ts)
y la capa de selectores en [`src/lib/mock-data/index.ts`](../src/lib/mock-data/index.ts).

## Estructura

```
backend/
  app/
    main.py            # FastAPI app, CORS, incluye los routers
    schemas.py         # modelos Pydantic (request/response)
    core/
      db.py             # get_connection() — psycopg + DATABASE_URL
      numero.py         # siguiente numero secuencial (V-0001, D-0001)
    services/
      route_analysis.py    # port de src/lib/route-analysis/find-path.ts (mock)
      suggest_vehiculo.py  # port de la heuristica de sugerencia de vehiculo
    api/
      tasa_cambio.py  productos.py  almacenes.py  clientes.py
      usuarios.py  vehiculos.py  ventas.py  despachos.py  historial.py
    jobs/
      sync_tasa_bcv.py       # sync diario de la tasa BCV (ver jobs/README.md)
    seed.py             # siembra Postgres con los datos de ejemplo de la demo
    seed_data.json       # generado una vez por scripts/export-mock-data.ts (ya no existe ese script — ver nota abajo)
  requirements.txt
```

## Setup (una sola vez)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

En la raíz del proyecto, copia `.env.example` a `.env` y completa
`DATABASE_URL` (revisa el puerto real de tu Postgres local — no siempre es
el 5432 por defecto).

Crear la base y las tablas (desde la raíz del proyecto):

```bash
"C:\Program Files\PostgreSQL\<version>\bin\createdb.exe" -U postgres -p <puerto> gestion_logistica
npx prisma migrate dev --name init
npx prisma generate
```

Sembrar los datos de ejemplo (misma info que se ve en la demo):

```bash
cd backend
.venv\Scripts\python.exe -m app.seed
```

Nota: `seed.py` nunca trunca `TasaCambio` — esa tabla ya tiene datos reales
del sync diario (`app/jobs/sync_tasa_bcv.py`) y no se quiere perder esa
información. Para vaciar todo lo demás (después de la demo):
`.venv\Scripts\python.exe -m app.seed --reset`.

## Correr el servidor

Desde la raíz del proyecto (necesitas el frontend corriendo en paralelo,
ver abajo):

```bash
npm run dev:api
```

Equivalente manual: `backend\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --app-dir backend`.

Swagger interactivo en `http://localhost:8000/docs`.

## Correr todo junto (frontend + API)

```bash
npm run dev:all
```

(o dos terminales: `npm run dev` y `npm run dev:api`). El frontend espera la
API en `NEXT_PUBLIC_API_URL` (`.env`, default `http://localhost:8000`).

Para cerrar todo (Next.js + uvicorn) al terminar de trabajar:

```bash
npm run stop
```

Cierra por puerto (3000/8000) y, si `uvicorn --reload` dejó un proceso hijo
huérfano (pasa a veces en Windows con `multiprocessing`), cae de respaldo a
cerrar los procesos `python`/`node` restantes. Ver
[`scripts/stop-dev.ps1`](../scripts/stop-dev.ps1).

## Fuera de alcance (todavía)

- Autenticación/RBAC — no hay login; las acciones usan el usuario mock fijo
  del topbar (`usuarioActual`).
- Conexión real a SuperMap iServer para el cálculo de rutas (sigue siendo
  una síntesis mock, ver `services/route_analysis.py`).
- Análisis TSP multi-parada.
- Despliegue en la nube — Postgres sigue local.
- Regenerar `seed_data.json` — el script que lo generaba
  (`scripts/export-mock-data.ts`) leía los arrays estáticos que antes vivían
  en `src/lib/mock-data/*.ts`; esos archivos ahora son wrappers de `fetch`
  hacia esta API, así que ese script ya no puede correr. El JSON generado
  se mantiene como snapshot fijo de los datos de la demo.

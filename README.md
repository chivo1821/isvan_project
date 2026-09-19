# Gestión Logística — ISVAN / TRALOG

Sistema de rutas, despachos, clientes, flota y seguimiento para una
distribuidora de helados y pizzas congeladas en Venezuela, que opera para
dos empresas (**ISVAN** y **TRALOG**) desde un mismo almacén (Almacén
Catia, Caracas).

Módulos: **Rutas** (agrupación sugerida por ruta comercial, capacidad y
cercanía; multi-parada, optimizadas contra SuperMap iServer),
**Despachos** (carga por Excel o manual, aprobación, ciclo de vida hasta
entrega), **Clientes** (por empresa, carga individual o masiva por Excel),
**Flota**, **Seguimiento** (mapa en vivo) y **Usuarios** (login por sesión,
permisos por rol).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | [Next.js 16](https://nextjs.org) (App Router, TypeScript), [shadcn/ui](https://ui.shadcn.com), Tailwind CSS v4, React Hook Form + Zod, Leaflet/React-Leaflet para mapas |
| Backend | [FastAPI](https://fastapi.tiangolo.com) (Python), acceso a datos con `psycopg` + SQL plano (sin ORM en Python) |
| Base de datos | PostgreSQL — [Prisma](https://www.prisma.io) es la fuente de verdad del esquema y las migraciones (no se usa `prisma-client-py`; ver la nota en `prisma/schema.prisma`) |
| Rutas / mapas | **PostGIS + pgRouting sobre la red vial guardada en la base** (ver «Red vial» más abajo). Como respaldo, [SuperMap iServer](https://www.supermap.com) y, si tampoco responde, una estimación en línea recta |
| Hosting | [Vercel](https://vercel.com) (frontend + backend como dos servicios bajo un dominio, ver `vercel.json`) + [Neon](https://neon.tech) (PostgreSQL administrado) |

## Dependencias principales

**Frontend** (`package.json`) — Next.js 16, React 19, `@prisma/client`,
`shadcn`/`radix-ui`/`@base-ui/react`, `react-hook-form` + `@hookform/resolvers`
+ `zod`, `@tanstack/react-table`, `leaflet` + `react-leaflet`, `recharts`,
`sonner`, `date-fns`. Dev: `prisma`, `typescript`, `tailwindcss`,
`concurrently` (corre frontend+backend juntos), `eslint`.

**Backend** (`backend/requirements.txt`) — `fastapi`, `uvicorn[standard]`,
`psycopg[binary]`, `httpx` (llamadas a SuperMap iServer), `pydantic`,
`python-dotenv`, `bcrypt` (hash de contraseñas), `python-multipart`
(subida de archivos), `openpyxl` (lectura de Excel).

## Desarrollo local

### 1. Clonar e instalar

```bash
npm install                       # instala deps de Next.js y corre "prisma generate"
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows; en Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 2. Variables de entorno

Copia `.env.example` a `.env` en la raíz del proyecto y completa:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Cadena de conexión de Postgres (local o Neon) |
| `NEXT_PUBLIC_API_URL` | URL del backend FastAPI (`http://localhost:8000` en dev) |
| `ALLOWED_ORIGINS` | Orígenes permitidos por CORS (el dominio del frontend) |
| `MOTOR_RUTAS` | Qué calcula las rutas: `auto` (por defecto: la red vial de la base y, si no, SuperMap), `bd` o `iserver` |
| `NETWORK_ANALYST_URL` | Servicio SuperMap iServer, ya solo como respaldo (opcional) |
| `NETWORK_ANALYST_WEIGHT_FIELD` | Campo de peso/costo del dataset de red (`time` por defecto) |
| `COOKIE_SECURE` | `false` en dev (HTTP), `true` en producción (HTTPS) — la cookie de sesión lo exige |

### 3. Base de datos

```bash
npx prisma migrate deploy   # aplica todas las migraciones (crea las tablas)
npx prisma generate         # ya corre solo con "npm install", pero por si acaso
```

> Este proyecto **ya no usa datos de ejemplo/mock** — las pruebas se hacen
> con datos reales (clientes y despachos cargados por Excel o a mano). Si
> igual quieres sembrar datos de demo para un ambiente local nuevo, existe
> `backend/app/seed.py` (`python -m app.seed`), pero no es parte del flujo
> normal de trabajo.

#### Datos iniciales obligatorios

Una base recién migrada queda vacía, pero hay **dos filas que el sistema
necesita sí o sí** para funcionar (no son datos de demo):

**1. El almacén de origen.** Todo despacho y toda ruta parten del Almacén
Catia; su `id` está fijo como `alm-catia` en el backend. Sin esta fila, crear
un despacho falla:

```sql
INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng", "esFrigorifico")
VALUES ('alm-catia', 'Almacén Catia', 'Centro de Distribución', 'Catia', 'Caracas', 10.512937, -66.944611, true);
```

**2. Un usuario ADMIN** para poder entrar (no hay registro público):

```sql
INSERT INTO "Usuario" ("id", "nombre", "email", "passwordHash", "rol", "activo")
VALUES ('usr-admin', 'Tu Nombre', 'tu@correo.com', '<hash-bcrypt>', 'ADMIN', true);
```

El hash se genera con Python: `python -c "import bcrypt; print(bcrypt.hashpw(b'tu-clave-temporal', bcrypt.gensalt()).decode())"`.
Una vez adentro, cualquier ADMIN puede crear más usuarios desde **Usuarios**
o restablecerles la contraseña — no hace falta repetir este paso a mano.

Los vehículos y clientes sí se cargan desde la app (Flota, y Clientes con su
carga masiva por Excel).

### 4. Correr todo

```bash
npm run dev:all
```

Abre [http://localhost:3000](http://localhost:3000). Swagger de la API en
`http://localhost:8000/docs`. Para cerrar todo: `npm run stop`.

Más detalle del backend (estructura de carpetas, endpoints, jobs) en
[`backend/README.md`](backend/README.md).

## Despliegue a producción (Vercel + Neon)

La app se despliega como **dos servicios bajo un mismo dominio de Vercel**
(ver `vercel.json`): el frontend Next.js en la raíz, y el backend FastAPI
bajo `/api/backend/*`. Vercel detecta el `requirements.txt` en `backend/` y
instala las dependencias de Python automáticamente; el `postinstall` de
`package.json` corre `prisma generate` en cada build.

**Cada push a la rama conectada en Vercel (`develop` o `master`, según el
proyecto) dispara un deploy automático** — no hace falta ningún paso manual
de build/deploy más allá de `git push`.

### Lo que sí requiere un paso manual

1. **Variables de entorno en Vercel** (Project Settings → Environment
   Variables) — las mismas que en `.env` local, apuntando a los valores de
   producción:
   - `DATABASE_URL`: connection string de **Neon**.
   - `NEXT_PUBLIC_API_URL`: la URL pública del propio deploy (ej.
     `https://tu-proyecto.vercel.app/api/backend` o el dominio final).
   - `ALLOWED_ORIGINS`: el dominio real del frontend en producción.
   - `NETWORK_ANALYST_URL` / `NETWORK_ANALYST_WEIGHT_FIELD`: el servicio
     SuperMap iServer real (si aplica).
   - `COOKIE_SECURE=true` (obligatorio en producción — HTTPS).

2. **Migraciones contra Neon** — Vercel **no** corre `prisma migrate
   deploy` automáticamente durante el build (solo `prisma generate`, que no
   toca la base de datos). Cada vez que el esquema cambie
   (`prisma/schema.prisma` + una carpeta nueva en `prisma/migrations/`),
   hay que aplicarlas a mano una vez, apuntando a Neon:

   ```bash
   DATABASE_URL="<connection string de Neon>" npx prisma migrate deploy
   ```

   Esto es intencional: nunca se corre contra producción sin que alguien lo
   dispare explícitamente.

3. **Primer usuario ADMIN** — igual que en local (paso 3 arriba), con un
   `INSERT` directo en Neon la primera vez; después, todo se gestiona desde
   la app.

### Notas

- La base de datos vive en Neon incluso si el desarrollo diario sigue
  usando Postgres local — solo hace falta que `DATABASE_URL` en `.env`
  apunte a uno u otro.
- No se sube ninguna credencial al repo — todo vía variables de entorno
  (`.env` local, Environment Variables en el dashboard de Vercel).

## Red vial (cálculo de rutas)

Las rutas y sus trazados se calculan con **PostGIS + pgRouting** sobre la red
vial guardada en la propia base, sin depender de ningún servicio externo. La
red de Venezuela son ~1,1 millones de tramos y ocupa **~490 MB** (383 MB de
tramos + 110 MB de nodos).

Se arma **una sola vez en local** y después se copia a las demás bases:

```bash
backend/.venv/Scripts/python.exe backend/scripts/cargar_red_vial.py "C:/ruta/redes_venezuela.shp"
```

El script acepta shapefile, GeoPackage, GeoJSON o un CSV con la geometría en
WKT; convierte con `ogr2ogr`, carga, **parte las vías en sus cruces** (el
shapefile de OpenStreetMap no las corta, y sin ese paso la red queda en
fragmentos y no aparece ninguna ruta), arma los nodos y deja un resumen en la
tabla `RedVialCarga`.

La velocidad de cada tramo **no** sale del dato original (OpenStreetMap trae
`maxspeed` en pocas vías): se asigna por tipo de vía con la tabla
`VELOCIDAD_POR_TIPO`, al inicio del script, que es donde se ajusta.

Al final el script hace `VACUUM FULL`: armar la red deja la tabla inflada al
triple (cada `UPDATE` de `source`/`target` reescribe la fila entera, y las
versiones viejas se quedan ocupando lugar). Compactarla ahorró 703 MB en la
carga nacional: 1.227 MB de base pasaron a 525 MB.

### Llevar la red a otra base (Neon)

Armar la red son varios minutos de CPU y casi millón y medio de escrituras en
una sola transacción: contra una base remota se corta a la mitad y no queda
nada, así que `cargar_red_vial.py` se niega a correr fuera de local. La red ya
construida se copia con:

```bash
backend/.venv/Scripts/python.exe backend/scripts/copiar_red_vial.py --origen "postgresql://...@localhost:5433/gestion_logistica" --destino "postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require"
```

Va por lotes de 50.000 tramos, confirma cada uno y **se puede volver a correr
las veces que haga falta**: retoma donde quedó. Antes hay que aplicar las
migraciones en el destino (`npx prisma migrate deploy`), que son las que crean
las extensiones y las tablas.

| Opción | Qué hace |
|---|---|
| `--sin-indices` | Borra los índices del destino durante la carga y los recrea al final (más rápido con el GIST) |
| `--simplificar 3` | Quita vértices del dibujo con 3 m de tolerancia sin mover los extremos, así que la topología y los costos siguen valiendo. Medido sobre la red nacional ahorra solo ~65 MB de 478, y el tramo más afectado se acorta 50 m: rara vez vale la pena |

Ojo con el plan de Neon: en el **Free** son 0,5 GB por proyecto y la red
nacional sola son ~490 MB. Al pasarse del límite, el compute se suspende y el
endpoint deja de aceptar conexiones (el síntoma es `server closed the
connection unexpectedly` ya al conectar, sin llegar a autenticar).

### Recortar la red a la zona de reparto

Cuando el espacio está contado, en vez de subir el país entero se copia la red
de los estados donde se reparte, más las troncales de todo el país para que un
cliente lejano siga teniendo ruta por carretera:

```bash
backend/.venv/Scripts/python.exe backend/scripts/copiar_red_vial.py --origen "postgresql://...@localhost:5433/gestion_logistica" --destino "postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require" --vaciar --sin-indices --zona "C:/ruta/ESTADO_4326.shp" --estados "Distrito Capital,Miranda,La Guaira,Carabobo,Aragua" --troncales
```

`--zona` acepta cualquier archivo de polígonos que lea GDAL; busca sola la
columna con los nombres y entiende los alias de siempre (La Guaira/Vargas,
Distrito Capital/Distrito Federal). `--margen` (5 km por defecto) agranda la
zona para no cortar una vía justo en el límite. Con `--medir` dice cuánto
ocuparía sin tocar el destino.

Medido sobre la red de Venezuela, con los cinco estados del centro-norte:

| | Tramos | Tamaño |
|---|---|---|
| Red nacional | 1.087.372 | 478 MB |
| Zona (5 estados, margen 5 km) | 247.210 | 102 MB |
| Zona + troncales del país | 287.115 | **120 MB** |
| Zona + troncales y secundarias | 301.473 | 127 MB |

Las troncales cuestan 18 MB y con ellas las rutas largas siguen saliendo
(Caracas → Maracaibo 697 km contra 668 de la red completa, y Barquisimeto,
Maturín, San Cristóbal y Mérida casi idénticas); las secundarias ya no cambian
ningún resultado. Las rutas urbanas dan exactamente los mismos kilómetros que
con la red nacional, y se calculan más rápido porque hay menos grafo.

Un cliente fuera de la zona y lejos de una troncal simplemente no engancha con
la red: `ruta_entre` devuelve `None` y el llamador usa su respaldo, como con
cualquier punto mal georreferenciado.

Cada ruta calculada queda en `RutaCalculada` y no se vuelve a resolver; las
distancias del pago de delivery se guardan además en `DistanciaCliente`.

## Documentación adicional

- [`backend/README.md`](backend/README.md) — estructura del backend, endpoints, jobs.
- [`docs/PLAN.md`](docs/PLAN.md) — decisiones de producto, arquitectura y módulos.
- [`docs/MODELO_DATOS.md`](docs/MODELO_DATOS.md) — entidades, relaciones y diagrama ER.

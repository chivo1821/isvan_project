# Gestión Logística — ISVAN / TRALOG

Sistema de rutas, despachos, clientes, flota y seguimiento para una
distribuidora de helados y pizzas congeladas en Venezuela, que opera para
dos empresas (**ISVAN** y **TRALOG**) desde un mismo almacén (Almacén
Catia, Caracas).

Módulos: **Rutas** (multi-parada, optimizadas contra SuperMap iServer),
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
| Rutas / mapas | [SuperMap iServer](https://www.supermap.com) (Transportation Analyst — FindPath y FindTSPPaths), con reemplazo automático a una ruta sintética si el servicio no responde |
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
| `NETWORK_ANALYST_URL` | Servicio SuperMap iServer para rutas reales (opcional — sin esto, cae a una ruta sintética) |
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

Con la base vacía, hace falta al menos un usuario ADMIN para poder entrar
(no hay registro público) — créalo con un INSERT directo:

```sql
INSERT INTO "Usuario" ("id", "nombre", "email", "passwordHash", "rol", "activo")
VALUES ('usr-admin', 'Tu Nombre', 'tu@correo.com', '<hash-bcrypt>', 'ADMIN', true);
```

El hash se genera con Python: `python -c "import bcrypt; print(bcrypt.hashpw(b'tu-clave-temporal', bcrypt.gensalt()).decode())"`.
Una vez adentro, cualquier ADMIN puede crear más usuarios desde **Usuarios**
o restablecerles la contraseña — no hace falta repetir este paso a mano.

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

## Documentación adicional

- [`backend/README.md`](backend/README.md) — estructura del backend, endpoints, jobs.
- [`docs/PLAN.md`](docs/PLAN.md) — decisiones de producto, arquitectura y módulos.
- [`docs/MODELO_DATOS.md`](docs/MODELO_DATOS.md) — entidades, relaciones y diagrama ER.

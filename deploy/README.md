# Instalación y entornos

El sistema corre de dos formas con el mismo código:

1. **Vercel + Neon + R2** (la de hoy): `vercel.json` publica el frontend y
   la API como servicios bajo un mismo dominio.
2. **Contenedores** (`docker-compose.yml`): para un servidor propio del
   cliente, una VM en AWS (EC2) o Google Cloud (Compute Engine), o un
   servicio de contenedores (ECS, Cloud Run). Mismas imágenes, configuración
   por variables de entorno.

## Entornos en Vercel y Neon

| Entorno | Rama de git | Base de datos |
|---|---|---|
| Producción | `master` | Neon, rama principal |
| Vista previa (Preview) | cualquier otra (`develop`, `administrativo`, ...) | Neon, rama `staging` |
| Desarrollo | local | Postgres local (`localhost:5433`) |

**Hoy Preview usa la base de producción.** Pasos para separarla (los hace
quien administra Vercel y Neon):

1. En Neon: *Branches → Create branch*, nombre `staging`, desde la rama de
   producción. Copiar su cadena de conexión.
2. En Vercel: *Settings → Environment Variables → DATABASE_URL*. Editar la
   variable para que quede solo en *Production*, y crear otra
   `DATABASE_URL` solo para *Preview* con la cadena de `staging`.
3. Volver a desplegar una vista previa y confirmar que escribe en `staging`.
4. Cada migración nueva se aplica primero en `staging`. Para refrescar
   `staging` con datos actuales: en Neon, *Reset from parent* sobre la rama.

Revisar también que en *Production* estén `COOKIE_SECURE=true`,
`CRON_SECRET` (sin ella el cron diario de la tasa BCV responde 503) y
`RESEND_API_KEY`: no aparecen en `vercel env ls`.

## Contenedores

Servicios de `docker-compose.yml`:

| Servicio | Qué es |
|---|---|
| `db` | Postgres 17 con PostGIS y pgRouting |
| `migrar` | Aplica las migraciones de Prisma y termina (se corre a mano) |
| `api` | FastAPI (`backend/Dockerfile`) |
| `web` | Next.js en modo standalone (`Dockerfile`, etapa `web`) |
| `proxy` | Caddy: `/api/backend/*` a la API y el resto a la web, en un solo dominio (como las rewrites de `vercel.json`); HTTPS automático con un dominio real |
| `tareas` | Las tareas programadas de `vercel.json` (tasa BCV diaria) |

```bash
cp deploy/variables.ejemplo deploy/.env      # completar contraseñas y secretos
docker compose --env-file deploy/.env build
docker compose --env-file deploy/.env up -d db
docker compose --env-file deploy/.env run --rm migrar
docker compose --env-file deploy/.env up -d
```

Para actualizar: `git pull`, `build`, `run --rm migrar`, `up -d`.

### Equivalencias en la nube

| Pieza | AWS | Google Cloud |
|---|---|---|
| web + api | ECS Fargate, App Runner o EC2 con compose | Cloud Run o Compute Engine con compose |
| db | RDS PostgreSQL (tiene PostGIS y pgRouting) | Cloud SQL (confirmar pgRouting) o Postgres en la VM |
| fotos y PDFs | S3 (`ALMACEN_FOTOS=s3`, `S3_ENDPOINT=s3.<region>.amazonaws.com`) | Cloud Storage (`ALMACEN_FOTOS=s3`, `S3_ENDPOINT=storage.googleapis.com`, `S3_REGION=auto`, claves HMAC) |
| tareas | EventBridge Scheduler llamando a `/tareas/...` con `Authorization: Bearer CRON_SECRET` | Cloud Scheduler, igual |
| correo | Resend o SES | Resend |

El bucket necesita CORS que permita `PUT` y `GET` desde el dominio del
sistema: el navegador sube las fotos directo, con un enlace firmado.

### Datos que no traen las migraciones

- La red vial para calcular rutas: `backend/scripts/cargar_red_vial.py`.
- Usuarios, almacenes, vehículos y la configuración inicial.

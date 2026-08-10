# Sync diario de la tasa BCV

Job standalone que consulta la tasa oficial del dólar (BCV) via
[dolarapi.com](https://ve.dolarapi.com/v1/dolares/oficial) y la guarda en la
tabla `TasaCambio` de Postgres. No depende de que FastAPI esté corriendo —
es un script suelto, pensado para dispararse una vez al día con la Tarea
Programada de Windows.

Ver la decisión de por qué esto usa `psycopg` + SQL plano en vez de
`prisma-client-py` en el comentario junto al `generator client` de
[`prisma/schema.prisma`](../../../prisma/schema.prisma).

## 1. Setup (una sola vez)

Desde `backend/`:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

En la raíz del proyecto, asegúrate de tener un `.env` (copiado de
`.env.example`) con `DATABASE_URL` apuntando a tu Postgres local, ej.:

```
DATABASE_URL="postgresql://postgres:TU_PASSWORD@localhost:5433/gestion_logistica"
```

(El puerto puede variar — revisa con qué puerto quedó corriendo tu
instalación de PostgreSQL si no es el 5432 por defecto.)

Si todavía no existe la base ni las tablas, desde la raíz del proyecto:

```bash
# Crea la base (te pide la contraseña del usuario postgres)
"C:\Program Files\PostgreSQL\<version>\bin\createdb.exe" -U postgres -p <puerto> gestion_logistica

# Crea las tablas a partir de prisma/schema.prisma
npx prisma migrate dev --name init
npx prisma generate
```

## 2. Probar el script a mano

```bash
cd backend
.venv\Scripts\python.exe app\jobs\sync_tasa_bcv.py
```

Debe imprimir algo como `OK 2026-08-10: 757.5406 Bs/USD`. Si falla, imprime
el error a stderr y **no** escribe nada en la base (nunca sobrescribe una
tasa buena con un dato vacío o inválido). Se puede correr varias veces el
mismo día sin problema — hace upsert por fecha, no duplica filas.

Verificar directo en la base:

```sql
SELECT * FROM "TasaCambio" ORDER BY "fecha" DESC;
```

## 3. Registrar la Tarea Programada de Windows (6:00pm diario)

Por terminal (PowerShell o cmd, reemplaza la ruta si tu proyecto vive en
otro lugar):

```
schtasks /Create /SC DAILY /ST 18:00 /TN "GestionLogistica_SyncTasaBCV" /TR "C:\Users\ADMIN\Documents\claude_code\gestion_logistica\backend\app\jobs\run_sync_tasa_bcv.bat"
```

Verificar que quedó creada:

```
schtasks /Query /TN "GestionLogistica_SyncTasaBCV" /V /FO LIST
```

Dispararla a mano para probar el flujo completo (incluyendo el .bat y el
log) sin esperar a las 6pm:

```
schtasks /Run /TN "GestionLogistica_SyncTasaBCV"
```

Borrarla si hace falta:

```
schtasks /Delete /TN "GestionLogistica_SyncTasaBCV" /F
```

### Alternativa por interfaz gráfica

Programador de tareas (`taskschd.msc`) → **Crear tarea básica** → nombre
`GestionLogistica_SyncTasaBCV` → Desencadenador: **Diariamente**, 18:00 →
Acción: **Iniciar un programa** → Programa/script:
`run_sync_tasa_bcv.bat` (usar la ruta completa a este archivo).

## 4. Logs

Cada corrida (manual o programada) agrega una entrada a
`backend/app/jobs/logs/sync_tasa_bcv.log` con fecha/hora y el resultado
(`OK ...` o `ERROR: ...`). Esa carpeta no se versiona (ver `.gitignore`).

## Notas de diseño

- La fila se guarda con la **fecha de publicación** que reporta el BCV
  (`fechaActualizacion` de la respuesta), no la fecha en que corre el
  script — así, si el BCV no publicó nada nuevo (fin de semana/feriado), el
  script simplemente vuelve a hacer upsert sobre el mismo día sin crear un
  registro "de hoy" engañoso.
- Si `dolarapi.com` falla o cambia de forma, el script sale con código de
  error y no toca la base — revisar `logs/sync_tasa_bcv.log`.
- Esta pieza está aislada del resto de la app: el frontend Next.js sigue
  leyendo datos mock (Fase 1). Conectar el frontend a leer `TasaCambio` en
  vivo es un paso posterior de Fase 2.

# Backend (Fase 2 — no implementado aún)

Este directorio es un stub para el futuro backend en **Python (FastAPI)** que expondrá
la lógica de negocio real (ventas, verificación de facturas pendientes, aprobaciones,
cálculo de rutas contra un SuperMap iServer real, asignación de vehículos) sobre
PostgreSQL.

Durante la Fase 1 (diseño de UI), el frontend en `..` consume únicamente datos mock
desde `src/lib/mock-data/`. Nada en este directorio se ejecuta todavía.

## Estructura planeada

```
backend/
  app/
    api/       # endpoints FastAPI (ventas, despachos, aprobaciones, flota, rutas)
    models/    # modelos SQLAlchemy (o el ORM que se decida) / equivalentes al schema.prisma
    core/      # config, conexión a DB, seguridad
  requirements.txt
```

## Próximos pasos (fuera de esta fase)

- Definir si el ORM en Python será SQLAlchemy (con el mismo modelo que `prisma/schema.prisma`
  como referencia) o `prisma-client-py`.
- Endpoints REST para cada módulo del frontend.
- Autenticación/RBAC.
- Integración real con SuperMap iServer (`NETWORK_ANALYST_URL`) para el cálculo de rutas,
  reemplazando `src/lib/route-analysis/find-path.ts` (mock).
- Algoritmo real de sugerencia de vehículos, reemplazando `src/lib/fleet/suggest-vehiculo.ts` (mock).

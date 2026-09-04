# Plan del proyecto — Gestión Logística

## Contexto

Sistema de rutas y despachos para una distribuidora venezolana de **helados
y pizzas congeladas**, que opera para **dos empresas** (ISVAN y TRALOG)
desde un mismo almacén (Almacén Catia, Caracas), compartiendo flota.
Módulos: Rutas (multi-parada), Despachos, Clientes, Flota, Seguimiento y
Usuarios (login real, permisos por rol).

**Ventas e Inventario quedaron fuera de alcance a propósito** en esta
versión (ver "Historial de decisiones", punto 2) — el sistema ya no lleva
catálogo de productos ni stock; cada ítem de un despacho es texto libre con
su propio peso, cargado por Excel o a mano.

- **Stack**: Next.js (App Router, TypeScript) + shadcn/ui en el frontend;
  backend **FastAPI (Python)** real sobre **PostgreSQL** (acceso con
  `psycopg` + SQL plano, sin ORM — ver `prisma/schema.prisma`); Prisma se
  usa como fuente de verdad del modelo de datos y para generar
  migraciones/tipos, no para el acceso a datos en Python.
- **Estilo visual**: paleta clara y cálida inspirada en heladerías
  venezolanas (crema + rojo-naranja + amarillo), sidebar agrupado por
  módulos, wizards con tarjetas numeradas.
- **Estado actual**: app completa y conectada de punta a punta, con **login
  real** y **desplegada en producción** (Vercel + Neon). Ver el
  [README principal](../README.md) para desarrollo local y despliegue.

## Arquitectura

```
Next.js (puerto 3000)  <-- fetch -->  FastAPI (puerto 8000)  <-- psycopg -->  Postgres (Neon en prod)
```

- **Lecturas**: cada página (Server Component) hace `fetch` server-side a la
  API vía la capa de selectores en
  [`src/lib/mock-data/index.ts`](../src/lib/mock-data/index.ts) (el nombre
  de la carpeta es historia — son wrappers de `fetch`, no datos mock; ver
  `src/lib/api-client.ts`, que reenvía la cookie de sesión en las llamadas
  servidor→servidor).
- **Escrituras**: los formularios/botones llaman la API directo desde el
  navegador (Client Components) — por eso FastAPI tiene CORS habilitado
  (con `allow_credentials=True`, para que la cookie de sesión viaje entre
  orígenes en desarrollo).
- **Sesión**: cookie httpOnly emitida por FastAPI, respaldada en la tabla
  `Sesion` (no JWT) — ver `backend/app/core/auth.py`. Casi todos los
  endpoints exigen sesión válida; varios además exigen un rol específico.
- **Correr todo**: `npm run dev:all`. Ver [`backend/README.md`](../backend/README.md).

## Módulos

| Módulo | Rutas | Qué hace |
|---|---|---|
| **Dashboard** | `/` | **Solo ADMIN.** KPIs de despachos/rutas/flota/clientes sin ubicación, rendimiento del reparto (entregas, kg, minutos en el cliente y de traslado, tabla por conductor) y mapa de rutas en tránsito |
| **Despachos** | `/despachos`, `/despachos/nuevo`, `/despachos/[id]`, `/despachos/aprobacion`, `/despachos/aprobacion/[id]` | Creación por **Excel** (extracto de ventas real del cliente, ISVAN o TRALOG) o **manual**; aprobación con modal de detalle (ítems, cliente, dirección) sin salir de la lista, y **aprobación en bloque de toda la cola solo para ADMIN** |
| **Rutas** | `/rutas`, `/rutas/nueva`, `/rutas/[id]` | **Sugiere cómo agrupar** los despachos aprobados en viajes (cercanía entre clientes + capacidad del vehículo, con la ruta comercial como desempate y costo estimado) y arma la ruta elegida, con el **orden de visita optimizado por SuperMap iServer (TSP)** partiendo siempre de Almacén Catia |
| **Clientes** | `/clientes` | Cartera por empresa (ISVAN/TRALOG); alta individual o **carga masiva por Excel** (con plantilla descargable), y descarga de la cartera |
| **Reportes** | `GET /reportes/{clientes,despachos,rutas}.xlsx`, `GET /reportes/resumen` | Descargas en Excel para gestión: cartera, despachos realizados (con productos y tiempos por parada) y viajes realizados (duración real vs estimada). Fuera del alcance del `REPARTIDOR` |
| **Flota** | `/flota`, `/flota/[id]` | CRUD de vehículos, compartidos entre ambas empresas |
| **Seguimiento** | `/seguimiento`, `/seguimiento/[id]` | Mapa con rutas activas y línea de tiempo por parada |
| **Despachador** | `/despachador`, `/despachador/[id]` | Vista del chofer: inicia el viaje, marca **llegada** y **entrega** en cada parada (las dos marcas alimentan los reportes de rendimiento). **Es el único módulo que ve un `REPARTIDOR`**, y solo con la ruta de su vehículo asignado |
| **Usuarios** | `/usuarios` | Login por sesión; ADMIN crea usuarios y restablece contraseñas (no hay recuperación por correo) |

## Historial de decisiones

1. **Paleta clara estilo heladería venezolana**, manteniendo la distribución
   de la referencia "Centinela".
2. **Se elimina Ventas e Inventario** de esta versión — el cliente pidió
   trabajar únicamente con Rutas, Despachos, Clientes, Flota, Seguimiento y
   Usuarios. Se borraron los modelos `Producto`, `StockAlmacen`,
   `TasaCambio`, `Factura`, `Venta`, `VentaItem`, `VentaRevision` y sus
   routers/páginas. `DespachoItem` pasó a ser autocontenido (descripción
   libre, peso por unidad, si requiere frío) en vez de referenciar un
   catálogo de productos.
3. **Login real** (antes no existía nada): cookie httpOnly + tabla
   `Sesion`, contraseñas con `bcrypt`. Sin JWT/OAuth ni recuperación por
   correo — desproporcionado para un equipo interno pequeño; en su lugar,
   un ADMIN restablece la contraseña de cualquier usuario desde **Usuarios**.
4. **Permisos por rol desde el lanzamiento** (`ADMIN`, `DESPACHOS`,
   `APROBADOR`, `REPARTIDOR`): quién puede crear despachos/rutas, aprobar,
   iniciar/entregar, y administrar clientes/vehículos/usuarios — aplicado
   tanto en la API (`requiere_rol`) como ocultando acciones en la UI.
   El `REPARTIDOR` es un caso más fuerte que «ocultar botones»: ver la
   decisión 12. El **dashboard es solo para ADMIN** por privacidad de los
   datos (muestra la operación completa y el rendimiento por conductor):
   cada rol entra a su propio módulo según `INICIO_POR_ROL`, y
   `(dashboard)/layout.tsx` redirige quien pida `/` sin ser ADMIN. Caso aparte: **aprobar toda la cola de despachos de una vez**
   (`POST /despachos/aprobacion/masiva`) es **solo ADMIN** — un `APROBADOR`
   puede aprobar de a uno, pero no en bloque. La UI esconde el botón y el
   endpoint rechaza con 403 a cualquier otro rol; la auditoría queda a
   nombre del ADMIN que ejecutó la acción, una fila por despacho.
5. **Dos empresas, un solo almacén y una sola flota**: ISVAN y TRALOG
   comparten Almacén Catia y los vehículos, pero **no comparten cartera de
   clientes** — el mismo código puede ser un cliente distinto según la
   empresa, así que `Cliente` quedó identificado por `(empresa, codigo)` en
   vez de `codigo` solo. La empresa se elige una vez al subir un Excel
   (de despachos o de clientes), no es una columna por fila.
6. **Carga de despachos por Excel, permanente** (no un parche temporal):
   como todavía no hay credenciales para conectarse a la base de ventas
   real del cliente, se sube el extracto de ventas tal cual lo exporta su
   sistema. Reglas confirmadas con el negocio:
   - Una fila = un ítem; el **número de documento** (no el código de
     cliente) agrupa filas en un despacho, y debe ser nuevo (evita
     reimportar el mismo archivo dos veces).
   - Filas con cantidad ≤ 0 son devoluciones/notas de crédito — se
     ignoran en silencio, no cuentan como error.
   - El peso por ítem sale de la columna **`litros`**, que es el contenido
     total de la fila según el sistema de ventas, y se toma como kilos
     **1 a 1** (confirmado por el negocio: un pote de 850 ml pesa 0,85 kg).
     No hay factor de densidad, y da lo mismo si el producto se mide por
     volumen o por peso — para las pizzas esa columna ya viene en kilos.
     El tamaño de presentación en la descripción quedó solo como respaldo
     para filas sin `litros`: no distingue los multi-empaque
     ("10X5X135ML").
   - Columna opcional `ruta`: la **ruta comercial** del cliente. El extracto
     de ventas es la fuente de verdad de ese dato — al confirmar la
     importación se guarda en la ficha del cliente y pesa al sugerir cómo
     agrupar las rutas (ver decisión 9).
   - Carga manual disponible en paralelo, mismo flujo de creación.
7. **Carga masiva de clientes por Excel**: mismas reglas de preview/confirmar
   que despachos. El código de cliente **siempre lo asigna el negocio**, el
   sistema nunca lo genera — columna obligatoria. Teléfono también
   obligatorio (lo usan los despachadores para contactar al cliente). La
   columna `ruta` (ruta comercial) es opcional acá: sirve para dar de alta
   un cliente ya con su ruta, sin esperar a su primera venta. Unas
   coordenadas en **(0, 0)** se rechazan como fila con error y, si ya están
   guardadas así, el cliente se muestra como «sin ubicación» y queda fuera
   de las rutas — es un dato faltante cargado como cero, no una posición
   real (ver `backend/app/core/ubicacion.py`). El importador además:
   - **rechaza** coordenadas fuera del recuadro de Venezuela (atrapa lat/lng
     invertidas o un signo perdido);
   - **avisa** cuando la columna de latitud parece haber perdido un dígito:
     si en buena parte del archivo la latitud tiene exactamente un decimal
     menos que la longitud de su misma fila. Pasó de verdad —
     `10.4986017` llegó como `10.986017` y dejó a 189 clientes en el mar.
     Es una coordenada numéricamente válida, así que fila por fila no se
     nota; solo se ve mirando la columna completa.
8. **Rutas multi-parada reales**, no solo un tramo origen→destino: un
   vehículo visita varias paradas por viaje, en el orden que calcula
   **SuperMap iServer (FindTSPPaths)** contra la red vial real — confirmado
   contra el servicio del cliente que sí optimiza el orden (no solo
   devuelve el orden de entrada, ver `stopIndexes` en la respuesta). El
   trazado se guarda completo (sin submuestrear), para no cortar curvas
   reales de las calles.
9. **Sugerencia de agrupación de rutas** (`POST /rutas/sugerencias`,
   `backend/app/services/plan_rutas.py`): el sistema propone qué despachos
   meter en cada vehículo, en este orden de peso —
   1. **Distancia entre clientes** (con el `lat`/`lng` que ya está en la
      base): manda sobre todo lo demás. Una parada solo entra al viaje si
      está a menos de `RADIO_MAX_ENTRE_PARADAS_KM` (12 km por defecto,
      ajustable desde la pantalla) de alguna de las que ya están, y a menos
      de ese radio × `FACTOR_EXTENSION_GRUPO` de la semilla del grupo.
   2. **Capacidad del vehículo** (kg) y **cadena de frío**: restricciones
      duras, nunca se propone un viaje que las viole.
   3. **Ruta comercial del cliente** (`Cliente.rutaComercial`): desempata
      entre paradas a distancia parecida. Se aplica como un **factor** sobre
      la distancia (`FACTOR_RUTA_DISTINTA`), no como kilómetros sumados, para
      que nunca arrastre un viaje largo. Quien arma la ruta puede volverla
      restricción dura con una casilla en la pantalla.
   4. **Costo** (`km × Vehiculo.costoPorKm`, con un valor de referencia por
      tipo si el vehículo no lo tiene cargado): informativo, no condiciona
      la agrupación — el cliente lo pidió como "si se puede".

   El orden 1↔3 se invirtió tras la primera prueba con datos reales: con la
   ruta comercial pesando primero, una ruta que abarca La Guaira y
   Charallave (a ~55 km) producía un viaje imposible. La distancia es ahora
   el criterio duro y la ruta comercial solo agrupa dentro de la misma zona.

   El tiempo estimado incluye lo que el vehículo pasa **detenido en cada
   cliente** (`MINUTOS_POR_PARADA`, 15 min): el servicio de rutas solo
   devuelve tiempo de manejo, que no es la naturaleza del reparto.

   Los km/tiempo/costo de las sugerencias son **estimados** (distancia en
   línea recta × factor de vialidad): son decenas de combinaciones y llamar
   al TSP por cada una sería lentísimo. El trazado real se calcula una sola
   vez, al confirmar la ruta.
10. **Deploy en Vercel + Neon**: dos servicios bajo un dominio (`vercel.json`)
   desplegados automáticamente en cada push a la rama conectada. Las
   migraciones **no** corren solas en el build — se aplican a mano
   (`prisma migrate deploy` apuntando a Neon) cada vez que cambia el
   esquema. Ver el [README principal](../README.md).
11. **Conexión directa a la base de ventas real**: en negociación con el
    cliente (credenciales pendientes). El plan acordado es que sea vía
    **API propia del cliente devolviendo JSON** (no conexión directa a su
    base de datos, que exigiría VPN incompatible con el hosting
    *serverless* de Vercel) — pendiente el contrato exacto (endpoint,
    autenticación, forma del JSON). La carga por Excel se mantiene
    disponible siempre, incluso después de que esa integración exista.

12. **Un `REPARTIDOR` solo ve su viaje**, no la operación: su única pantalla
    es el despachador, y ahí únicamente la ruta activa del vehículo que se
    le asignó (`Usuario.vehiculoAsignadoId`). No ve Inicio, ni clientes, ni
    la cola de despachos, ni la flota, ni las rutas de otros vehículos.
    - Se aplica en **dos capas**: la interfaz esconde los módulos y
      `(dashboard)/layout.tsx` devuelve al despachador cualquier otra URL;
      y sobre todo **la API filtra los datos por vehículo asignado**
      (`backend/app/core/permisos.py`), porque esconder un módulo no impide
      llamar el endpoint a mano. Las rutas ajenas responden **404** y no
      403, para no confirmar que existen.
    - Un vehículo no puede tener dos rutas activas a la vez (`POST /rutas`
      lo rechaza), que es lo que hace que el repartidor tenga exactamente
      un viaje a la vista.
    - Un repartidor sin vehículo asignado no ve ninguna ruta, y la pantalla
      se lo dice.
    - El ADMIN asigna el vehículo desde **Usuarios**
      (`PATCH /usuarios/{id}/vehiculo`).

## Modelo de datos

Ver [`docs/MODELO_DATOS.md`](./MODELO_DATOS.md) para el detalle de
entidades, relaciones y diagrama ER. Fuente técnica:
[`prisma/schema.prisma`](../prisma/schema.prisma). Fuente técnica de la
API: [`backend/README.md`](../backend/README.md).

## Fuera de alcance

- **Ventas e Inventario** — eliminados a propósito de esta versión (ver
  decisión 2). No hay catálogo de productos ni control de stock.
- **Recuperación de contraseña por correo** — no hay servicio de correo
  configurado; lo maneja un ADMIN restableciendo la contraseña directamente.
- **Conexión directa a la base de datos del cliente** — se optó por una
  futura API propia del cliente en su lugar (ver decisión 11).

"""Modelos Pydantic — reflejan 1:1 las tablas que crea prisma/schema.prisma
(mismos nombres de campo en camelCase, ya que las columnas de Postgres
tambien son camelCase — Prisma no aplica snake_case). Filas planas por
tabla, salvo Despacho/Ruta que anidan sus items/despachos para no romper la
forma que ya espera el frontend.

Nota: los modelos de respuesta (Usuario, etc.) nunca declaran passwordHash —
aunque los SELECT * de los routers devuelvan esa columna, Pydantic solo
serializa los campos declarados en el modelo, asi que nunca sale en el JSON.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Annotated, Literal, Optional

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field

from app.services import bancos
from app.services import motorizados as mt


def en_utc(valor: datetime) -> datetime:
    return valor.replace(tzinfo=timezone.utc) if valor.tzinfo is None else valor


# Un instante guardado en UTC sin zona (ver app/core/fechas.py). Sale en el
# JSON con su zona ("...Z"): sin ella el navegador lo toma como hora local y
# lo muestra 4 horas corrido (las 11:00 de Caracas se veian como 15:00).
# Las fechas de calendario guardadas a medianoche (ultimaRevision,
# fechaEstimadaEntrega) no son instantes y siguen como datetime.
Instante = Annotated[datetime, AfterValidator(en_utc)]


# ---------- Usuarios / autenticacion ----------


def _normalizar_correo(valor: str) -> str:
    return valor.strip().lower()


# El correo con el que se entra: sin espacios y en minusculas, tanto al
# crear el usuario como al hacer login. Si no, "Juan@..." y "juan@..." son
# dos correos distintos y el usuario ve "contraseña incorrecta" sin saber
# por que.
Correo = Annotated[str, AfterValidator(_normalizar_correo)]

_FORMATO_CORREO = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def _correo_con_formato(valor: str) -> str:
    if not _FORMATO_CORREO.fullmatch(valor):
        raise ValueError("El correo no tiene un formato valido")
    return valor


# Al CREAR un usuario se exige ademas un formato de correo. El login sigue
# con Correo a secas: un usuario viejo con un correo raro no se queda afuera.
CorreoNuevo = Annotated[str, AfterValidator(_normalizar_correo), AfterValidator(_correo_con_formato)]


def _clave_dentro_de_bcrypt(valor: str) -> str:
    """bcrypt solo usa los primeros 72 bytes, y desde la version 5 una clave
    mas larga es un error (era un 500 en el login y al crear usuarios)."""
    if len(valor.encode("utf-8")) > 72:
        raise ValueError("La contraseña no puede pasar de 72 bytes (unos 72 caracteres sin acentos)")
    return valor


ClaveNueva = Annotated[str, AfterValidator(_clave_dentro_de_bcrypt)]


class Usuario(BaseModel):
    id: str
    nombre: str
    # None solo en los motorizados autogestionados (entran con placa + PIN).
    email: Optional[str] = None
    rol: str
    avatarUrl: Optional[str] = None
    activo: bool
    autogestionado: bool = False
    telefono: Optional[str] = None
    # Solo aplica al rol REPARTIDOR: el vehiculo que maneja, y por lo tanto
    # la unica ruta que puede ver (ver app/core/permisos.py).
    vehiculoAsignadoId: Optional[str] = None
    # Puede aprobar despachos de clientes con deuda vencida (ver cartera.py).
    autorizaExcepciones: bool = False


# Los valores de los enums de la base (prisma/schema.prisma). Validarlos aca
# devuelve un 422 claro; si no, un valor raro llegaba hasta Postgres y era un 500.
RolUsuario = Literal["ADMIN", "DESPACHOS", "APROBADOR", "REPARTIDOR", "VENDEDOR", "COBRANZAS"]
TipoVehiculo = Literal["CAMION_REFRIGERADO", "CAMIONETA", "MOTO"]
EstadoVehiculo = Literal["FUNCIONAL", "EN_MANTENIMIENTO", "FUERA_DE_SERVICIO"]


def _salida_razonable(valor: datetime) -> datetime:
    """Una salida programada fuera de esto es un error de tipeo (o un ataque):
    con el anio 9999 el calculo de horarios se desbordaba en un 500."""
    if not 2000 <= valor.year <= 2100:
        raise ValueError("La fecha de salida tiene que estar entre los anios 2000 y 2100")
    return valor


SalidaProgramada = Annotated[AwareDatetime, AfterValidator(_salida_razonable)]


class UsuarioCreate(BaseModel):
    nombre: str
    email: CorreoNuevo
    rol: RolUsuario
    password: ClaveNueva
    vehiculoAsignadoId: Optional[str] = None


class AsignarVehiculoRequest(BaseModel):
    # None = quitarle el vehiculo asignado.
    vehiculoAsignadoId: Optional[str] = None


class RutaVenta(BaseModel):
    """Una ruta del sistema de ventas (R1..R8, 10, 11...) dentro de su
    empresa: los codigos se repiten entre ISVAN y TRALOG."""

    empresa: Literal["ISVAN", "TRALOG"]
    ruta: str


class AsignarRutasVentaRequest(BaseModel):
    # Reemplaza todas las rutas del vendedor; lista vacia = quitarselas.
    rutas: list[RutaVenta]


# ---------- Vendedores (ver app/api/vendedor.py) ----------


class DespachoVendedor(BaseModel):
    """Un despacho visto por el vendedor: solo lectura, lo justo para saber
    si ya salio y si ya llego al cliente."""

    id: str
    numero: str
    numeroDocumento: str
    estado: str
    fechaCreacion: Instante
    llegadaEn: Optional[Instante] = None
    entregadoEn: Optional[Instante] = None
    rutaNumero: Optional[str] = None
    rutaEstado: Optional[str] = None
    empresa: str
    clienteCodigo: str
    clienteNombre: str
    rutaVenta: str


class DespachosVendedor(BaseModel):
    # Sus rutas: vacia = todavia no se le asigno ninguna (y no ve nada).
    rutas: list[RutaVenta]
    despachos: list[DespachoVendedor]


class Visita(BaseModel):
    id: str
    empresa: str
    codigoCliente: str
    semana: date
    llegadaEn: Instante
    llegadaLat: Optional[float] = None
    llegadaLng: Optional[float] = None
    llegadaPrecisionM: Optional[float] = None
    distanciaClienteM: Optional[float] = None
    salidaEn: Optional[Instante] = None
    observaciones: Optional[str] = None


class ClienteDeLaSemana(BaseModel):
    empresa: str
    codigo: str
    nombre: str
    ruta: str
    # Coordenadas del maestro de logistica, si el cliente esta ahi y las
    # tiene validas: sin ellas no sale en el mapa ni se mide la distancia.
    lat: Optional[float] = None
    lng: Optional[float] = None
    estatus: Literal["por_visitar", "en_cliente", "atendido"]
    visitas: list[Visita] = []


class VisitasSemana(BaseModel):
    semana: date
    rutas: list[RutaVenta]
    clientes: list[ClienteDeLaSemana]
    visitaAbierta: Optional[Visita] = None


class IniciarVisitaRequest(BaseModel):
    empresa: Literal["ISVAN", "TRALOG"]
    codigoCliente: str
    lat: float
    lng: float
    precisionM: Optional[float] = None


class TerminarVisitaRequest(BaseModel):
    observaciones: Optional[str] = None


class RendimientoVendedor(BaseModel):
    vendedorId: str
    nombre: str
    rutas: list[str]
    clientesAsignados: int
    clientesAtendidos: int
    coberturaPct: Optional[float] = None
    visitas: int
    promedioMinEnCliente: Optional[float] = None
    # Visitas cuya llegada quedo lejos del cliente (ver
    # vendedor.DISTANCIA_MAX_AL_CLIENTE_M): senal de que no fue en persona.
    visitasLejos: int
    ultimaVisita: Optional[Instante] = None
    # Venta neta (USD) del mes de sus rutas, del modulo de indicadores.
    ventaNetaMes: Optional[float] = None


class RendimientoVendedores(BaseModel):
    semana: date
    mesVenta: Optional[date] = None
    distanciaMaxM: int
    porVendedor: list[RendimientoVendedor]


# ---------- Motorizados autogestionados (ver app/services/motorizados.py) ----------


def _nombre_motorizado(valor: str) -> str:
    valor = " ".join(valor.split())
    if not 3 <= len(valor) <= 80:
        raise ValueError("Escribe tu nombre y apellido (entre 3 y 80 caracteres)")
    return valor


class RegistroMotorizadoRequest(BaseModel):
    codigoRegistro: Annotated[str, Field(max_length=64)]
    nombre: Annotated[str, AfterValidator(_nombre_motorizado)]
    placa: Annotated[str, Field(max_length=20), AfterValidator(mt.validar_placa)]
    telefono: Annotated[str, Field(max_length=20), AfterValidator(mt.validar_telefono)]
    pin: Annotated[str, AfterValidator(mt.validar_pin)]


class LoginMotorizadoRequest(BaseModel):
    placa: Annotated[str, Field(max_length=20)]
    pin: Annotated[str, Field(max_length=12)]


class Motorizado(BaseModel):
    id: str
    nombre: str
    telefono: Optional[str] = None
    activo: bool
    vehiculoId: Optional[str] = None
    placa: Optional[str] = None
    estadoVehiculo: Optional[str] = None
    capacidadKg: Optional[float] = None
    registradoEn: Instante
    bloqueadoHasta: Optional[Instante] = None
    rutas: int
    ultimaRuta: Optional[Instante] = None


class PinRestablecido(BaseModel):
    pin: str


class CodigoRegistro(BaseModel):
    codigo: Optional[str] = None
    actualizadoEn: Optional[Instante] = None
    actualizadoPor: Optional[str] = None


class CodigoRegistroUpdate(BaseModel):
    codigo: Annotated[str, Field(max_length=64)]


class LoginRequest(BaseModel):
    email: Correo
    password: str


class CambiarPasswordRequest(BaseModel):
    passwordActual: str
    passwordNueva: ClaveNueva


class ResetPasswordRequest(BaseModel):
    passwordNueva: ClaveNueva


class PermisoExcepcionesRequest(BaseModel):
    autoriza: bool


# ---------- Almacen / flota ----------


class Almacen(BaseModel):
    id: str
    nombre: str
    tipo: str
    direccion: str
    ciudad: str
    lat: float
    lng: float
    esFrigorifico: bool


class Vehiculo(BaseModel):
    id: str
    placa: str
    tipo: str
    capacidadKg: float
    tieneRefrigeracion: bool
    estado: str
    almacenBaseId: str
    conductorNombre: Optional[str] = None
    ultimaRevision: Optional[datetime] = None
    costoPorKm: Optional[float] = None
    # Quien lo maneja hoy (ver app/core/conductor.py). Solo lectura: se
    # cambia asignandole el vehiculo a un usuario repartidor.
    conductor: Optional[str] = None


class VehiculoCreate(BaseModel):
    placa: str
    tipo: TipoVehiculo
    capacidadKg: float
    tieneRefrigeracion: bool = True
    conductorNombre: Optional[str] = None
    costoPorKm: Optional[float] = None


class VehiculoEstadoUpdate(BaseModel):
    estado: EstadoVehiculo


class SugerenciaVehiculo(BaseModel):
    vehiculo: Vehiculo
    # Morocho: la segunda moto (ver app/services/morocho.py).
    vehiculoApoyo: Optional[Vehiculo] = None
    morocho: bool = False
    holguraKg: float
    motivos: list[str]


class SugerenciaVehiculoRequest(BaseModel):
    despachoIds: list[str]
    # Para que vehiculos estar libre: la salida programada de la ruta y, si
    # es una ruta que ya existe (asignarle vehiculo), su id para no contarla
    # contra si misma. Sin salida: ahora.
    salidaProgramada: Optional[SalidaProgramada] = None
    rutaId: Optional[str] = None


# ---------- Clientes ----------

Empresa = Literal["ISVAN", "TRALOG"]


class Cliente(BaseModel):
    id: str
    empresa: Empresa
    codigo: str
    nombre: str
    tipo: str
    direccion: str
    ciudad: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    telefono: str
    email: Optional[str] = None
    # Ruta comercial (de venta/reparto) del negocio, p.ej. "R-07" — no es la
    # Ruta (viaje) de este sistema. Ver plan_rutas.py.
    rutaComercial: Optional[str] = None


class ClienteCreate(BaseModel):
    empresa: Empresa
    codigo: str
    nombre: str
    tipo: str
    direccion: str
    ciudad: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    telefono: str
    email: Optional[str] = None
    rutaComercial: Optional[str] = None


# ---------- Despachos ----------


class DespachoItem(BaseModel):
    id: str
    descripcion: str
    cantidad: int
    cantidadSolicitada: int
    pesoUnitarioKg: float
    requiereFrio: bool


class DespachoItemCreate(BaseModel):
    descripcion: str
    cantidad: int
    pesoUnitarioKg: float
    requiereFrio: bool = True


class Despacho(BaseModel):
    id: str
    numero: str
    numeroDocumento: str
    origenId: str
    destinoClienteId: str
    creadoPorId: str
    estado: str
    fechaCreacion: Instante
    fechaEstimadaEntrega: Optional[datetime] = None
    rutaId: Optional[str] = None
    ordenEnRuta: Optional[int] = None
    # Marcas que pone el repartidor en la calle (ver app/api/rutas.py).
    llegadaEn: Optional[Instante] = None
    entregadoEn: Optional[Instante] = None
    items: list[DespachoItem] = []


class DespachoCreate(BaseModel):
    # Quien lo crea sale de la sesion, no del cuerpo (ver crear_despacho).
    destinoClienteId: str
    numeroDocumento: str
    items: list[DespachoItemCreate]


class DespachoAprobacion(BaseModel):
    id: str
    despachoId: str
    usuarioId: str
    accion: str
    comentario: Optional[str] = None
    fecha: Instante


class ExcepcionDespachoIn(BaseModel):
    motivo: Annotated[str, Field(min_length=5, max_length=300)]


class DespachoAprobacionCreate(BaseModel):
    # Quien aprueba sale de la sesion, no del cuerpo.
    accion: Literal["APROBADA", "RECHAZADA"]
    comentario: Optional[Annotated[str, Field(max_length=500)]] = None
    # Aprobar aunque el cliente tenga deuda vencida (solo usuarios
    # autorizados; ver app/services/cartera.py).
    excepcion: Optional[ExcepcionDespachoIn] = None


class ActualizarCantidadDespachoItemRequest(BaseModel):
    cantidad: int


class AprobacionMasivaRequest(BaseModel):
    # Vacio = todos los despachos pendientes de aprobacion.
    despachoIds: list[str] = []
    comentario: Optional[str] = None


class DespachoOmitido(BaseModel):
    numero: str
    vencidoUsd: float


class AprobacionMasivaResponse(BaseModel):
    aprobados: int
    numeros: list[str]
    # Los de clientes con deuda vencida no se aprueban en lote: necesitan una
    # excepcion, despacho por despacho.
    omitidos: list[DespachoOmitido] = []


# ---------- Importacion de Excel ----------


class ImportarExcelFilaError(BaseModel):
    fila: int
    columna: Optional[str] = None
    motivo: str


class ImportarExcelItemPreview(BaseModel):
    descripcion: str
    cantidad: int
    pesoUnitarioKg: float
    requiereFrio: bool


class ImportarExcelGrupoPreview(BaseModel):
    numeroDocumento: str
    clienteId: str
    clienteCodigo: str
    clienteNombre: str
    # Ruta comercial que trae el extracto de ventas para ese cliente (columna
    # opcional). Al confirmar la importacion se guarda en el Cliente: el
    # sistema de ventas es la fuente de verdad de ese dato.
    rutaComercial: Optional[str] = None
    items: list[ImportarExcelItemPreview]


class ColumnaLeida(BaseModel):
    campo: str
    columna: str
    encabezado: Optional[str] = None
    ejemplos: list[str] = []


class ImportarExcelPreviewResponse(BaseModel):
    grupos: list[ImportarExcelGrupoPreview]
    errores: list[ImportarExcelFilaError]
    # False si el archivo vino sin encabezado y las columnas se reconocieron
    # por su contenido.
    conEncabezado: bool = True
    columnas: list[ColumnaLeida] = []


class ImportarExcelConfirmarRequest(BaseModel):
    grupos: list[ImportarExcelGrupoPreview]


class ImportarClientesPreviewResponse(BaseModel):
    clientes: list[ClienteCreate]
    errores: list[ImportarExcelFilaError]
    # Avisos sobre el archivo completo (no bloquean la importacion): p.ej.
    # que la columna de latitud parezca haber perdido un digito.
    advertencias: list[str] = []


class ImportarClientesConfirmarRequest(BaseModel):
    clientes: list[ClienteCreate]


# ---------- Rutas (multi-parada) ----------


class RutaPunto(BaseModel):
    id: str
    rutaId: str
    orden: int
    lat: float
    lng: float
    estado: str
    timestamp: Instante
    descripcion: Optional[str] = None
    paradaDespachoId: Optional[str] = None


class AvisoRuta(BaseModel):
    """Algo que hay que resolver antes de la salida (ver
    app/services/planificacion.py). No bloquea: se muestra."""

    tipo: str
    mensaje: str
    rutaId: Optional[str] = None


class Ruta(BaseModel):
    id: str
    numero: str
    # Sin vehiculo mientras no se asigne (planificacion, ver app/services/planificacion.py).
    vehiculoId: Optional[str] = None
    # Morocho: la segunda moto (ver app/services/morocho.py).
    vehiculoApoyoId: Optional[str] = None
    origenId: str
    creadoPorId: str
    estado: str
    fechaCreacion: Instante
    # Fecha y hora de salida del almacen: la de recogida de todos sus pedidos.
    salidaProgramada: Instante
    # Salida del almacen y fin del viaje (ver app/api/rutas.py).
    iniciadaEn: Optional[Instante] = None
    completadaEn: Optional[Instante] = None
    distanciaTotalKm: Optional[float] = None
    tiempoTotalMin: Optional[int] = None
    # Reverso (ver POST /rutas/{id}/reversar): quien, cuando, por que y que
    # despachos llevaba la ruta antes de liberarlos.
    canceladaEn: Optional[Instante] = None
    canceladaPorId: Optional[str] = None
    motivoCancelacion: Optional[str] = None
    despachosAlCancelar: Optional[list[str]] = None
    despachos: list[Despacho] = []
    puntos: list[RutaPunto] = []
    avisos: list[AvisoRuta] = []


class ReversarRutaRequest(BaseModel):
    motivo: str


class RutaCreate(BaseModel):
    despachoIds: list[str]
    # Opcional: la ruta se puede planificar y asignarle vehiculo despues.
    vehiculoId: Optional[str] = None
    # Morocho: la segunda moto (la principal es vehiculoId).
    vehiculoApoyoId: Optional[str] = None
    salidaProgramada: SalidaProgramada


class RutaProgramacion(BaseModel):
    """Reprogramar una ruta planificada y/o cambiarle el vehiculo. Un campo
    que no viene no se toca; vehiculoId en null le quita el vehiculo."""

    salidaProgramada: Optional[SalidaProgramada] = None
    vehiculoId: Optional[str] = None
    # Morocho: la segunda moto; en null se le quita (deja de ser Morocho).
    vehiculoApoyoId: Optional[str] = None


# ---------- Sugerencia de agrupacion de rutas ----------


class SugerenciaRuta(BaseModel):
    """Un viaje propuesto: que despachos agrupar y en que vehiculo. Las
    metricas son estimadas (distancia en linea recta corregida por un factor
    de vialidad); el trazado real lo calcula el TSP al crear la ruta."""

    # None si a esa hora no queda ningun vehiculo libre: el viaje se propone
    # igual (no se frena la planificacion) y se le asigna vehiculo despues.
    vehiculo: Optional[Vehiculo] = None
    # Morocho: un pedido que no cabe en una moto sale en dos; esta es la
    # segunda (ver app/services/morocho.py).
    vehiculoApoyo: Optional[Vehiculo] = None
    morocho: bool = False
    despachoIds: list[str]
    paradas: int
    pesoKg: float
    usoCapacidadPct: float
    distanciaKmEstimada: float
    tiempoMinEstimado: int
    costoEstimado: Optional[float] = None
    rutasComerciales: list[str]
    motivos: list[str]


class DespachosSinAsignar(BaseModel):
    despachoIds: list[str]
    motivo: str


class PlanRutasResponse(BaseModel):
    sugerencias: list[SugerenciaRuta]
    sinAsignar: list[DespachosSinAsignar]
    # Lo que conviene saber del plan sin que lo cambie (p. ej. los Morochos
    # dejaron paradas livianas fuera de las motos).
    advertencias: list[str] = []


class PlanRutasRequest(BaseModel):
    # Si viene vacio se consideran todos los despachos aprobados sin ruta.
    despachoIds: list[str] = []
    # False = no mezclar clientes de rutas comerciales distintas en un mismo
    # viaje (restriccion dura). True = preferir agruparlos, pero permitir
    # mezclar antes que mandar un vehiculo a medio llenar.
    mezclarRutasComerciales: bool = True
    # True = antes que los camiones, llenar las motos libres (motorizados)
    # con los despachos livianos y cercanos que les caben. False = consolidar
    # en la menor cantidad de vehiculos (las motos solo si sobra algo chico).
    priorizarMotos: bool = True
    # Distancia maxima (km) entre una parada y las demas del mismo viaje.
    # Vacio = el valor por defecto del servicio
    # (plan_rutas.RADIO_MAX_ENTRE_PARADAS_KM).
    radioMaxKm: Optional[float] = None
    # Para cuando se planifica: se proponen los vehiculos libres a esa hora.
    # Vacio = ahora.
    salidaProgramada: Optional[SalidaProgramada] = None


# ---------- Reportes ----------


class RendimientoConductor(BaseModel):
    conductor: Optional[str] = None
    placa: str
    viajes: int
    entregas: int
    distanciaKm: float


class RangoTabuladorDelivery(BaseModel):
    """Un rango del tabulador: hasta hastaKm se pagan montoUsd. El ultimo va
    sin tope (hastaKm = None)."""

    hastaKm: Optional[float] = None
    montoUsd: float


class TabuladorDeliveryUpdate(BaseModel):
    rangos: list[RangoTabuladorDelivery]


class LiquidacionDeliveryCreate(BaseModel):
    repartidorId: str
    desde: date
    hasta: date
    nota: Optional[str] = None


class ResumenRendimiento(BaseModel):
    """Indicadores del reparto para el dashboard (ver app/api/reportes.py).
    Los promedios son None mientras no haya paradas con las dos marcas."""

    dias: int
    entregas: int
    kgEntregados: float
    paradasMedidas: int
    promedioAtencionMin: Optional[float] = None
    promedioTrasladoMin: Optional[float] = None
    porConductor: list[RendimientoConductor] = []


# ---------- Metas de venta ----------


class MetaVentaItem(BaseModel):
    ruta: str
    # Cualquier dia del mes; el backend lo lleva al primero.
    mes: date
    # 0 o negativo borra la meta de esa ruta y ese mes.
    montoUsd: float


class GuardarMetasRequest(BaseModel):
    empresa: Empresa
    metas: list[MetaVentaItem]


# ---------- Cobranzas ----------
#
# Los datos de un pago se validan segun su metodo en
# app/services/pagos.normalizar (que campos son obligatorios depende del
# metodo); aca solo los tipos y los topes de largo.

MetodoPago = Literal["PAGO_MOVIL", "TRANSFERENCIA", "EFECTIVO", "DIVISAS", "RETENCION", "AJUSTE"]
TextoCorto = Annotated[str, Field(max_length=40)]


class PagoAplicacionIn(BaseModel):
    documentoId: Annotated[str, Field(max_length=64)]
    montoUsd: Annotated[float, Field(gt=0, le=1e10)]


class _PagoBase(BaseModel):
    empresa: Empresa
    codigoCliente: Annotated[str, Field(min_length=1, max_length=30)]
    fechaPago: date
    montoBs: Optional[Annotated[float, Field(gt=0, le=1e12)]] = None
    bancoCodigo: Optional[TextoCorto] = None
    telefono: Optional[TextoCorto] = None
    cedulaRif: Optional[TextoCorto] = None
    cuenta: Optional[TextoCorto] = None
    referencia: Optional[TextoCorto] = None
    nota: Optional[Annotated[str, Field(max_length=500)]] = None
    aplicaciones: Annotated[list[PagoAplicacionIn], Field(max_length=200)] = []


class PagoManualCreate(_PagoBase):
    """Un pago que registra cobranzas (queda verificado)."""
    metodo: MetodoPago
    montoUsd: Optional[Annotated[float, Field(gt=0, le=1e10)]] = None


class PagoPortalCreate(_PagoBase):
    """Un pago que reporta el cliente desde el portal."""
    metodo: Literal["PAGO_MOVIL", "TRANSFERENCIA"]
    comprobanteClave: Optional[Annotated[str, Field(max_length=200)]] = None


class VerificarPagoRequest(BaseModel):
    # None: se quedan las aplicaciones que propuso el cliente.
    aplicaciones: Optional[Annotated[list[PagoAplicacionIn], Field(max_length=200)]] = None


class RechazarPagoRequest(BaseModel):
    motivo: Annotated[str, Field(min_length=3, max_length=300)]


class AjustesCobranzaUpdate(BaseModel):
    diasTolerancia: Optional[Annotated[int, Field(ge=0, le=180)]] = None
    inicioCartera: Optional[date] = None


class TasaManualRequest(BaseModel):
    fecha: date
    tasa: Annotated[float, Field(gt=0, le=1e8)]


def _clave_portal(valor: str) -> str:
    if len(valor) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres")
    if valor.isdigit() or valor.isalpha():
        raise ValueError("La contraseña debe combinar letras y números")
    return _clave_dentro_de_bcrypt(valor)


def _nombre_portal(valor: str) -> str:
    limpio = " ".join(valor.split())
    if len(limpio) < 2:
        raise ValueError("Escribe tu nombre o el de tu negocio")
    return limpio


def _cedula_rif(valor: str) -> str:
    return bancos.normalizar_cedula_rif(valor)


def _codigo_cliente(valor: str) -> str:
    """Como lo guarda el sistema de ventas: sin ceros a la izquierda."""
    limpio = valor.strip()
    if not re.fullmatch(r"[A-Za-z0-9-]{1,20}", limpio):
        raise ValueError("El código de cliente no es válido")
    return limpio.lstrip("0") or "0"


ClavePortal = Annotated[str, Field(max_length=200), AfterValidator(_clave_portal)]
CodigoCorreo = Annotated[str, Field(max_length=12)]


class RegistroPortalRequest(BaseModel):
    email: Annotated[CorreoNuevo, Field(max_length=200)]
    password: ClavePortal
    nombre: Annotated[str, Field(max_length=120), AfterValidator(_nombre_portal)]
    rif: Annotated[str, Field(max_length=20), AfterValidator(_cedula_rif)]
    telefono: Annotated[str, Field(max_length=20), AfterValidator(mt.validar_telefono)]
    # Lo que el cliente dice ser; cobranzas lo valida si no se vincula solo.
    empresa: Optional[Empresa] = None
    codigoCliente: Optional[Annotated[str, Field(max_length=20), AfterValidator(_codigo_cliente)]] = None


class ConfirmarCorreoRequest(BaseModel):
    email: Annotated[Correo, Field(max_length=200)]
    codigo: CodigoCorreo


class CorreoRequest(BaseModel):
    email: Annotated[Correo, Field(max_length=200)]


class LoginPortalRequest(BaseModel):
    email: Annotated[Correo, Field(max_length=200)]
    password: Annotated[str, Field(max_length=200)]


class CambiarClavePortalRequest(BaseModel):
    email: Annotated[Correo, Field(max_length=200)]
    codigo: CodigoCorreo
    password: ClavePortal


class VincularClienteRequest(BaseModel):
    empresa: Empresa
    codigoCliente: Annotated[str, Field(max_length=20), AfterValidator(_codigo_cliente)]


class CuentaBancariaEmpresaIn(BaseModel):
    empresa: Empresa
    bancoCodigo: TextoCorto
    tipo: Literal["PAGO_MOVIL", "TRANSFERENCIA"]
    numero: TextoCorto
    rif: TextoCorto
    titular: Annotated[str, Field(min_length=2, max_length=120)]
    activa: bool = True

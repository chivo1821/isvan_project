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

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

# ---------- Usuarios / autenticacion ----------


class Usuario(BaseModel):
    id: str
    nombre: str
    email: str
    rol: str
    avatarUrl: Optional[str] = None
    activo: bool
    # Solo aplica al rol REPARTIDOR: el vehiculo que maneja, y por lo tanto
    # la unica ruta que puede ver (ver app/core/permisos.py).
    vehiculoAsignadoId: Optional[str] = None


class UsuarioCreate(BaseModel):
    nombre: str
    email: str
    rol: str
    password: str
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
    fechaCreacion: datetime
    llegadaEn: Optional[datetime] = None
    entregadoEn: Optional[datetime] = None
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
    llegadaEn: datetime
    llegadaLat: Optional[float] = None
    llegadaLng: Optional[float] = None
    llegadaPrecisionM: Optional[float] = None
    distanciaClienteM: Optional[float] = None
    salidaEn: Optional[datetime] = None
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
    ultimaVisita: Optional[datetime] = None
    # Venta neta (USD) del mes de sus rutas, del modulo de indicadores.
    ventaNetaMes: Optional[float] = None


class RendimientoVendedores(BaseModel):
    semana: date
    mesVenta: Optional[date] = None
    distanciaMaxM: int
    porVendedor: list[RendimientoVendedor]


class LoginRequest(BaseModel):
    email: str
    password: str


class CambiarPasswordRequest(BaseModel):
    passwordActual: str
    passwordNueva: str


class ResetPasswordRequest(BaseModel):
    passwordNueva: str


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
    tipo: str
    capacidadKg: float
    tieneRefrigeracion: bool = True
    conductorNombre: Optional[str] = None
    costoPorKm: Optional[float] = None


class VehiculoEstadoUpdate(BaseModel):
    estado: str


class SugerenciaVehiculo(BaseModel):
    vehiculo: Vehiculo
    holguraKg: float
    motivos: list[str]


class SugerenciaVehiculoRequest(BaseModel):
    despachoIds: list[str]


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
    fechaCreacion: datetime
    fechaEstimadaEntrega: Optional[datetime] = None
    rutaId: Optional[str] = None
    ordenEnRuta: Optional[int] = None
    # Marcas que pone el repartidor en la calle (ver app/api/rutas.py).
    llegadaEn: Optional[datetime] = None
    entregadoEn: Optional[datetime] = None
    items: list[DespachoItem] = []


class DespachoCreate(BaseModel):
    destinoClienteId: str
    numeroDocumento: str
    creadoPorId: str
    items: list[DespachoItemCreate]


class DespachoAprobacion(BaseModel):
    id: str
    despachoId: str
    usuarioId: str
    accion: str
    comentario: Optional[str] = None
    fecha: datetime


class DespachoAprobacionCreate(BaseModel):
    usuarioId: str
    accion: Literal["APROBADA", "RECHAZADA"]
    comentario: Optional[str] = None


class ActualizarCantidadDespachoItemRequest(BaseModel):
    cantidad: int


class AprobacionMasivaRequest(BaseModel):
    # Vacio = todos los despachos pendientes de aprobacion.
    despachoIds: list[str] = []
    comentario: Optional[str] = None


class AprobacionMasivaResponse(BaseModel):
    aprobados: int
    numeros: list[str]


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
    creadoPorId: str
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
    timestamp: datetime
    descripcion: Optional[str] = None
    paradaDespachoId: Optional[str] = None


class Ruta(BaseModel):
    id: str
    numero: str
    vehiculoId: str
    origenId: str
    creadoPorId: str
    estado: str
    fechaCreacion: datetime
    # Salida del almacen y fin del viaje (ver app/api/rutas.py).
    iniciadaEn: Optional[datetime] = None
    completadaEn: Optional[datetime] = None
    distanciaTotalKm: Optional[float] = None
    tiempoTotalMin: Optional[int] = None
    # Reverso (ver POST /rutas/{id}/reversar): quien, cuando, por que y que
    # despachos llevaba la ruta antes de liberarlos.
    canceladaEn: Optional[datetime] = None
    canceladaPorId: Optional[str] = None
    motivoCancelacion: Optional[str] = None
    despachosAlCancelar: Optional[list[str]] = None
    despachos: list[Despacho] = []
    puntos: list[RutaPunto] = []


class ReversarRutaRequest(BaseModel):
    motivo: str


class RutaCreate(BaseModel):
    despachoIds: list[str]
    vehiculoId: str
    creadoPorId: str


# ---------- Sugerencia de agrupacion de rutas ----------


class SugerenciaRuta(BaseModel):
    """Un viaje propuesto: que despachos agrupar y en que vehiculo. Las
    metricas son estimadas (distancia en linea recta corregida por un factor
    de vialidad); el trazado real lo calcula el TSP al crear la ruta."""

    vehiculo: Vehiculo
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


class PlanRutasRequest(BaseModel):
    # Si viene vacio se consideran todos los despachos aprobados sin ruta.
    despachoIds: list[str] = []
    # False = no mezclar clientes de rutas comerciales distintas en un mismo
    # viaje (restriccion dura). True = preferir agruparlos, pero permitir
    # mezclar antes que mandar un vehiculo a medio llenar.
    mezclarRutasComerciales: bool = True
    # Distancia maxima (km) entre una parada y las demas del mismo viaje.
    # Vacio = el valor por defecto del servicio
    # (plan_rutas.RADIO_MAX_ENTRE_PARADAS_KM).
    radioMaxKm: Optional[float] = None


# ---------- Reportes ----------


class RendimientoConductor(BaseModel):
    conductor: Optional[str] = None
    placa: str
    viajes: int
    entregas: int
    distanciaKm: float


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

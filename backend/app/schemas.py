"""Modelos Pydantic — reflejan 1:1 los tipos TS en src/lib/mock-data/types.ts
(mismos nombres de campo en camelCase, ya que las columnas de Postgres
tambien son camelCase — Prisma no aplica snake_case). Filas planas por
tabla, salvo Venta/Despacho que anidan sus items (asi ya vienen los arrays
crudos del mock, ver ventas.ts/despachos.ts) para no romper la forma que ya
espera el frontend.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, PlainSerializer

# Postgres/psycopg entrega estos campos como Decimal; Pydantic por defecto
# los serializa a JSON como *string* (para no perder precision), pero el
# frontend TS los tipa como "number" — sin este serializer, sumar/formatear
# esos valores en JS hace concatenacion de texto en vez de aritmetica
# (ej. "USD NaN"). Se serializan como float: para montos de esta demo no hay
# perdida de precision relevante.
Money = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]

# ---------- Catalogo ----------


class Usuario(BaseModel):
    id: str
    nombre: str
    email: str
    rol: str
    avatarUrl: Optional[str] = None
    activo: bool


class UsuarioCreate(BaseModel):
    nombre: str
    email: str
    rol: str


class Producto(BaseModel):
    id: str
    sku: str
    nombre: str
    categoria: str
    subcategoria: Optional[str] = None
    unidadMedida: str
    requiereCadenaFrio: bool
    temperaturaMinC: Optional[int] = None
    temperaturaMaxC: Optional[int] = None
    precioUnitario: Money
    imagenUrl: Optional[str] = None
    activo: bool


class Almacen(BaseModel):
    id: str
    nombre: str
    tipo: str
    direccion: str
    ciudad: str
    lat: float
    lng: float
    esFrigorifico: bool


class StockAlmacen(BaseModel):
    id: str
    productoId: str
    almacenId: str
    cantidad: int
    stockMinimo: int


# ---------- Clientes / Facturas ----------


class Cliente(BaseModel):
    codigo: str
    nombre: str
    tipo: str
    direccion: str
    ciudad: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    telefono: Optional[str] = None
    email: Optional[str] = None


class Factura(BaseModel):
    id: str
    numero: str
    clienteId: str
    monto: Money
    tasaBcv: Money
    fechaEmision: datetime
    fechaVencimiento: datetime
    estado: str
    fechaPago: Optional[datetime] = None
    montoPagado: Optional[Money] = None
    metodoPago: Optional[str] = None
    pagoAprobado: bool


# ---------- Tasa de cambio ----------


class TasaCambio(BaseModel):
    id: str
    fecha: datetime
    tasa: Money


# ---------- Flota ----------


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


class VehiculoCreate(BaseModel):
    placa: str
    tipo: str
    capacidadKg: float
    tieneRefrigeracion: bool = True
    conductorNombre: Optional[str] = None


class VehiculoEstadoUpdate(BaseModel):
    estado: str


class SugerenciaVehiculo(BaseModel):
    vehiculo: Vehiculo
    holguraKg: float
    motivos: list[str]


# ---------- Ventas ----------


class VentaItem(BaseModel):
    id: str
    productoId: str
    cantidad: int
    precioUnitario: Money
    subtotal: Money


class VentaItemCreate(BaseModel):
    productoId: str
    cantidad: int


class Venta(BaseModel):
    id: str
    numero: str
    clienteId: str
    vendedorId: str
    fecha: datetime
    estado: str
    total: Money
    tasaBcv: Money
    items: list[VentaItem] = []


class VentaCreate(BaseModel):
    clienteId: str
    vendedorId: str
    items: list[VentaItemCreate]


class VentaRevision(BaseModel):
    id: str
    ventaId: str
    usuarioId: str
    accion: str
    comentario: Optional[str] = None
    fecha: datetime


class VentaRevisionCreate(BaseModel):
    usuarioId: str
    accion: Literal["APROBADA", "RECHAZADA"]
    comentario: Optional[str] = None


# ---------- Despachos ----------


class DespachoItem(BaseModel):
    id: str
    productoId: str
    cantidad: int
    cantidadSolicitada: int


class Despacho(BaseModel):
    id: str
    numero: str
    ventaId: Optional[str] = None
    origenId: str
    destinoClienteId: str
    creadoPorId: str
    estado: str
    fechaCreacion: datetime
    fechaEstimadaEntrega: Optional[datetime] = None
    vehiculoId: Optional[str] = None
    distanciaEstimadaKm: Optional[float] = None
    tiempoEstimadoMin: Optional[int] = None
    rutaCalculada: bool
    items: list[DespachoItem] = []


class DespachoCreate(BaseModel):
    ventaId: str
    creadoPorId: str


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


class RutaPunto(BaseModel):
    id: str
    despachoId: str
    orden: int
    lat: float
    lng: float
    estado: str
    timestamp: datetime
    descripcion: Optional[str] = None


class RutaCalculada(BaseModel):
    distanciaEstimadaKm: float
    tiempoEstimadoMin: int
    ruta: list[RutaPunto]


class AsignarVehiculoRequest(BaseModel):
    vehiculoId: str


class ActualizarCantidadDespachoItemRequest(BaseModel):
    cantidad: int

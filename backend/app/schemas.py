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

from datetime import datetime
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


class UsuarioCreate(BaseModel):
    nombre: str
    email: str
    rol: str
    password: str


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
    items: list[ImportarExcelItemPreview]


class ImportarExcelPreviewResponse(BaseModel):
    grupos: list[ImportarExcelGrupoPreview]
    errores: list[ImportarExcelFilaError]


class ImportarExcelConfirmarRequest(BaseModel):
    creadoPorId: str
    grupos: list[ImportarExcelGrupoPreview]


class ImportarClientesPreviewResponse(BaseModel):
    clientes: list[ClienteCreate]
    errores: list[ImportarExcelFilaError]


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
    distanciaTotalKm: Optional[float] = None
    tiempoTotalMin: Optional[int] = None
    despachos: list[Despacho] = []
    puntos: list[RutaPunto] = []


class RutaCreate(BaseModel):
    despachoIds: list[str]
    vehiculoId: str
    creadoPorId: str

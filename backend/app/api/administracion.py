"""Administracion del sistema administrativo: empresas fiscales, permisos,
interruptores de modulos, bitacora y estado de la tasa BCV."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.db import get_connection
from app.core.fechas import ahora_utc, hoy_caracas
from app.core.permisos import permisos_del_usuario, requiere_permiso
from app.services import bitacora, empresas, tasa_bcv

router = APIRouter(tags=["administracion"])

# Los documentos se emiten con la ultima tasa publicada. Si es mas vieja que
# esto (un fin de semana largo cabe), se avisa y la emision se frena hasta
# que haya una nueva o se cargue a mano.
DIAS_TASA_VIGENTE = 4


class EmpresaFiscalUpdate(BaseModel):
    rif: str | None = Field(default=None, max_length=20)
    razonSocial: str = Field(min_length=2, max_length=200)
    nombreComercial: str | None = Field(default=None, max_length=200)
    domicilioFiscal: str | None = Field(default=None, max_length=500)
    telefono: str | None = Field(default=None, max_length=40)
    correo: str | None = Field(default=None, max_length=200)
    contribuyenteEspecial: bool = False
    agenteRetencionIva: bool = False
    porcentajeRetencionIva: int | None = None
    agenteRetencionIslr: bool = False


class ModuloUpdate(BaseModel):
    activo: bool


def _normalizar_rif(rif: str | None) -> str | None:
    """"j-12345678-9" -> "J-12345678-9". Letras validas: V, E, J, P, G, C."""
    if not rif or not rif.strip():
        return None
    limpio = rif.strip().upper().replace(" ", "")

    m = re.fullmatch(r"([VEJPGC])-?(\d{8})-?(\d)", limpio)
    if not m:
        raise HTTPException(400, "El RIF debe tener la forma J-12345678-9")
    return f"{m[1]}-{m[2]}-{m[3]}"


@router.get("/empresas")
def listar_empresas(usuario: dict = Depends(get_current_user)):
    """Las empresas a las que entra el usuario, con lo que les falta para
    facturar y sus modulos encendidos."""
    with get_connection() as conn, conn.cursor() as cur:
        filas = empresas.del_usuario(cur, usuario)
        return [
            {**e, "faltaParaFacturar": empresas.faltantes_para_facturar(e), "modulos": empresas.modulos_de(cur, e["id"])}
            for e in filas
        ]


@router.put("/empresas/{empresa_id}")
def editar_empresa(
    empresa_id: str, data: EmpresaFiscalUpdate, usuario: dict = Depends(requiere_permiso("empresas.administrar"))
):
    if data.agenteRetencionIva and data.porcentajeRetencionIva not in (75, 100):
        raise HTTPException(400, "Un agente de retencion de IVA retiene el 75 o el 100 %")
    with get_connection() as conn, conn.cursor() as cur:
        antes = empresas.exigir(cur, usuario, empresa_id)
        valores = data.model_dump()
        valores["rif"] = _normalizar_rif(data.rif)
        if not data.agenteRetencionIva:
            valores["porcentajeRetencionIva"] = None
        columnas = ", ".join(f'"{c}" = %({c})s' for c in valores)
        cur.execute(
            f'UPDATE "EmpresaFiscal" SET {columnas}, "actualizadaEn" = %(ahora)s WHERE "id" = %(id)s '
            f"RETURNING {empresas.COLUMNAS}",
            {**valores, "ahora": ahora_utc(), "id": empresa_id},
        )
        despues = cur.fetchone()
        bitacora.registrar(cur, usuario["id"], "EmpresaFiscal", empresa_id, "editar", antes, despues)
        conn.commit()
    return {**despues, "faltaParaFacturar": empresas.faltantes_para_facturar(despues)}


@router.put("/empresas/{empresa_id}/modulos/{modulo}")
def encender_modulo(
    empresa_id: str, modulo: str, data: ModuloUpdate, usuario: dict = Depends(requiere_permiso("empresas.administrar"))
):
    if modulo not in empresas.MODULOS:
        raise HTTPException(404, "Modulo desconocido")
    with get_connection() as conn, conn.cursor() as cur:
        empresa = empresas.exigir(cur, usuario, empresa_id)
        if data.activo and modulo == "ventas" and empresas.faltantes_para_facturar(empresa):
            faltan = ", ".join(empresas.faltantes_para_facturar(empresa))
            raise HTTPException(409, f"Faltan datos fiscales de la empresa para facturar: {faltan}")
        empresas.activar_modulo(cur, modulo, empresa_id, data.activo, usuario["id"])
        bitacora.registrar(
            cur, usuario["id"], "EmpresaFiscal", empresa_id, "encender" if data.activo else "apagar", None, {"modulo": modulo}
        )
        conn.commit()
        return empresas.modulos_de(cur, empresa_id)


@router.get("/permisos/mios")
def mis_permisos(usuario: dict = Depends(get_current_user)):
    with get_connection() as conn, conn.cursor() as cur:
        return sorted(permisos_del_usuario(cur, usuario))


@router.get("/permisos")
def catalogo_permisos(usuario: dict = Depends(requiere_permiso("empresas.administrar"))):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "codigo", "modulo", "descripcion" FROM "Permiso" ORDER BY "modulo", "codigo"')
        permisos = cur.fetchall()
        cur.execute('SELECT "rol", "permisoCodigo" FROM "RolPermiso" ORDER BY "rol"')
        por_rol: dict[str, list[str]] = {}
        for f in cur.fetchall():
            por_rol.setdefault(f["rol"], []).append(f["permisoCodigo"])
        return {"permisos": permisos, "porRol": por_rol}


@router.get("/bitacora/{entidad}/{entidad_id}")
def ver_bitacora(entidad: str, entidad_id: str, usuario: dict = Depends(requiere_permiso("bitacora.ver"))):
    with get_connection() as conn, conn.cursor() as cur:
        return bitacora.de(cur, entidad, entidad_id)


def estado_tasa(cur) -> dict:
    """La tasa con que se emitiria hoy y si sirve para emitir."""
    fila = tasa_bcv.ultima(cur)
    hoy = hoy_caracas()
    if not fila:
        return {"fecha": None, "tasa": None, "fuente": None, "vigente": False, "diasDesde": None}
    dias = (hoy - fila["fecha"]).days
    return {
        "fecha": fila["fecha"],
        "tasa": float(fila["tasa"]),
        "fuente": fila["fuente"],
        "vigente": dias <= DIAS_TASA_VIGENTE,
        "diasDesde": dias,
    }


@router.get("/tasa/estado")
def ver_estado_tasa(usuario: dict = Depends(get_current_user)):
    with get_connection() as conn, conn.cursor() as cur:
        return estado_tasa(cur)


def tasa_para_emitir(cur) -> dict:
    """La tasa vigente; 409 si no hay una reciente (los documentos no salen
    sin tasa)."""
    estado = estado_tasa(cur)
    if not estado["vigente"]:
        cuando = f"la ultima es del {estado['fecha']}" if estado["fecha"] else "no hay ninguna cargada"
        raise HTTPException(409, f"No hay tasa BCV reciente ({cuando}). Cargala en Cobranzas antes de emitir.")
    return estado

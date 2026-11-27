"""Empresas fiscales (EmpresaFiscal) y a cuales entra cada usuario.

Un usuario sin filas en UsuarioEmpresa entra a todas las de su organizacion:
asi siguen funcionando los usuarios de hoy sin configurar nada.
"""

from __future__ import annotations

from fastapi import HTTPException

COLUMNAS = (
    '"id", "organizacionId", "codigo", "rif", "razonSocial", "nombreComercial", "domicilioFiscal", "telefono", '
    '"correo", "contribuyenteEspecial", "agenteRetencionIva", "porcentajeRetencionIva", "agenteRetencionIslr", "activa"'
)

# Lo minimo para emitir un documento fiscal a nombre de la empresa.
REQUERIDOS_PARA_FACTURAR = ("rif", "razonSocial", "domicilioFiscal")


def del_usuario(cur, usuario: dict) -> list[dict]:
    cur.execute(
        f'SELECT {COLUMNAS} FROM "EmpresaFiscal" e WHERE e."organizacionId" = %s AND e."activa" '
        'AND (NOT EXISTS (SELECT 1 FROM "UsuarioEmpresa" WHERE "usuarioId" = %s) '
        '     OR e."id" IN (SELECT "empresaId" FROM "UsuarioEmpresa" WHERE "usuarioId" = %s)) '
        'ORDER BY e."codigo"',
        (usuario.get("organizacionId", "org-principal"), usuario["id"], usuario["id"]),
    )
    return cur.fetchall()


def exigir(cur, usuario: dict, empresa_id: str) -> dict:
    """La empresa si el usuario entra a ella; si no, 404 (no se dice si existe)."""
    for empresa in del_usuario(cur, usuario):
        if empresa["id"] == empresa_id:
            return empresa
    raise HTTPException(404, "Empresa no encontrada")


def faltantes_para_facturar(empresa: dict) -> list[str]:
    return [c for c in REQUERIDOS_PARA_FACTURAR if not (empresa.get(c) or "").strip()]


# ---------- Interruptores de modulos por empresa ----------
# En Configuracion, clave "modulo.<modulo>.<empresaId>" = true/false. Apagados
# por defecto: lo nuevo no aparece hasta encenderlo.
MODULOS = ("ventas", "inventario", "bancos")


def _clave(modulo: str, empresa_id: str) -> str:
    if modulo not in MODULOS:
        raise ValueError(f"Modulo desconocido: {modulo}")
    return f"modulo.{modulo}.{empresa_id}"


def modulo_activo(cur, modulo: str, empresa_id: str) -> bool:
    cur.execute('SELECT "valor" FROM "Configuracion" WHERE "clave" = %s', (_clave(modulo, empresa_id),))
    fila = cur.fetchone()
    return bool(fila and fila["valor"] is True)


def modulos_de(cur, empresa_id: str) -> dict[str, bool]:
    return {m: modulo_activo(cur, m, empresa_id) for m in MODULOS}


def activar_modulo(cur, modulo: str, empresa_id: str, activo: bool, usuario_id: str) -> None:
    from psycopg.types.json import Jsonb

    from app.core.fechas import ahora_utc

    cur.execute(
        'INSERT INTO "Configuracion" ("clave", "valor", "actualizadoEn", "actualizadoPorId") VALUES (%s, %s, %s, %s) '
        'ON CONFLICT ("clave") DO UPDATE SET "valor" = EXCLUDED."valor", "actualizadoEn" = EXCLUDED."actualizadoEn", '
        '"actualizadoPorId" = EXCLUDED."actualizadoPorId"',
        (_clave(modulo, empresa_id), Jsonb(activo), ahora_utc(), usuario_id),
    )

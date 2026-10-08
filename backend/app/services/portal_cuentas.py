"""Cuentas del portal de clientes: registro con correo y clave, codigo de
confirmacion por correo, ingreso, recuperar la clave y vinculacion con los
clientes.

Reglas:
- El registro y la recuperacion responden lo mismo exista o no el correo:
  el portal no sirve para averiguar quien es cliente.
- Codigos de 6 digitos, 15 minutos, 5 intentos, uno nuevo cada 60 s como
  minimo. Solo se guarda su hash.
- Ingreso: 5 claves fallidas bloquean la cuenta 15 minutos (como el PIN de
  los motorizados, app/services/motorizados.py).
- Al confirmar el correo, la cuenta se vincula sola con los clientes que
  tienen ese mismo correo registrado (Cliente.email): ese correo lo cargo la
  empresa y el cliente acaba de probar que es suyo. Si no hay ninguno, queda
  POR_VALIDAR hasta que cobranzas la vincule.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta
from functools import lru_cache

from fastapi import HTTPException

from app.core.auth import hash_password, verify_password
from app.core.fechas import ahora_utc
from app.core.portal_auth import cerrar_sesiones
from app.services import correo

INTENTOS_MAXIMOS = 5
MINUTOS_BLOQUEO = 15
VIGENCIA_CODIGO = timedelta(minutes=15)
ESPERA_REENVIO = timedelta(seconds=60)
INTENTOS_CODIGO = 5

CONFIRMAR = "CONFIRMAR"
RECUPERAR = "RECUPERAR"

_ASUNTOS = {
    CONFIRMAR: "Tu código para confirmar el correo",
    RECUPERAR: "Tu código para cambiar la contraseña",
}
_TEXTOS = {
    CONFIRMAR: "Usa este código para confirmar tu correo en el portal de clientes. Vence en 15 minutos.",
    RECUPERAR: "Usa este código para elegir una contraseña nueva en el portal de clientes. Vence en 15 minutos. "
               "Si no lo pediste, ignora este correo: tu contraseña sigue igual.",
}


def _hash_codigo(cuenta_id: str, codigo: str) -> str:
    return hashlib.sha256(f"{cuenta_id}:{codigo}".encode("utf-8")).hexdigest()


def _por_email(cur, email: str, bloquear: bool = False) -> dict | None:
    cur.execute(
        'SELECT * FROM "CuentaPortal" WHERE "email" = %s' + (" FOR UPDATE" if bloquear else ""),
        (email,),
    )
    return cur.fetchone()


def enviar_codigo(cur, cuenta: dict, proposito: str) -> bool:
    """Genera y envia un codigo nuevo (los anteriores dejan de valer). False
    si se pidio otro hace menos de 60 s: no se envia nada."""
    ahora = ahora_utc()
    cur.execute(
        'SELECT max("enviadoEn") AS "ultimo" FROM "CodigoCorreo" WHERE "cuentaId" = %s AND "proposito" = %s',
        (cuenta["id"], proposito),
    )
    ultimo = cur.fetchone()["ultimo"]
    if ultimo and ahora - ultimo < ESPERA_REENVIO:
        return False
    codigo = f"{secrets.randbelow(1_000_000):06d}"
    cur.execute(
        'UPDATE "CodigoCorreo" SET "usadoEn" = %s WHERE "cuentaId" = %s AND "proposito" = %s AND "usadoEn" IS NULL',
        (ahora, cuenta["id"], proposito),
    )
    cur.execute(
        'INSERT INTO "CodigoCorreo" ("id", "cuentaId", "proposito", "codigoHash", "enviadoEn", "expiraEn") '
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (f"cod-{uuid.uuid4().hex[:16]}", cuenta["id"], proposito, _hash_codigo(cuenta["id"], codigo), ahora,
         ahora + VIGENCIA_CODIGO),
    )
    try:
        correo.enviar(cuenta["email"], _ASUNTOS[proposito], [f"Hola, {cuenta['nombre']}.", _TEXTOS[proposito]], codigo)
    except correo.CorreoNoDisponible as e:
        raise HTTPException(503, "No pudimos enviar el correo en este momento. Intenta más tarde.") from e
    return True


def _usar_codigo(cur, cuenta: dict, proposito: str, codigo: str) -> None:
    """Valida el codigo y lo marca usado. 400 generico si no sirve (no dice
    si vencio o si estaba mal, para no ayudar a adivinarlo)."""
    cur.execute(
        'SELECT * FROM "CodigoCorreo" WHERE "cuentaId" = %s AND "proposito" = %s AND "usadoEn" IS NULL '
        'ORDER BY "enviadoEn" DESC LIMIT 1 FOR UPDATE',
        (cuenta["id"], proposito),
    )
    fila = cur.fetchone()
    invalido = HTTPException(400, "El código no es correcto o ya venció. Pide uno nuevo.")
    if not fila or fila["expiraEn"] <= ahora_utc() or fila["intentos"] >= INTENTOS_CODIGO:
        raise invalido
    if not hmac.compare_digest(fila["codigoHash"], _hash_codigo(cuenta["id"], (codigo or "").strip())):
        cur.execute('UPDATE "CodigoCorreo" SET "intentos" = "intentos" + 1 WHERE "id" = %s', (fila["id"],))
        cur.connection.commit()
        raise invalido
    cur.execute('UPDATE "CodigoCorreo" SET "usadoEn" = %s WHERE "id" = %s', (ahora_utc(), fila["id"]))


@lru_cache(maxsize=1)
def _hash_de_relleno() -> str:
    return hash_password(secrets.token_urlsafe(16))


def _cuenta_falsa_para_tiempo() -> None:
    """Gasta lo mismo que un bcrypt real cuando el correo no existe, para que
    el tiempo de respuesta no delate que cuentas hay."""
    verify_password("x", _hash_de_relleno())


def registrar(cur, datos: dict) -> None:
    """Crea la cuenta (o actualiza una que nunca confirmo su correo) y envia
    el codigo. Si el correo ya tiene una cuenta confirmada no hace nada: la
    respuesta es la misma para no revelarlo."""
    cuenta = _por_email(cur, datos["email"], bloquear=True)
    clave = hash_password(datos["password"])
    if cuenta is None:
        cuenta = {
            "id": f"cta-{uuid.uuid4().hex[:16]}", "email": datos["email"], "nombre": datos["nombre"],
        }
        cur.execute(
            'INSERT INTO "CuentaPortal" ("id", "email", "passwordHash", "nombre", "rif", "telefono", '
            '"empresaDeclarada", "codigoDeclarado", "createdAt") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
            (cuenta["id"], datos["email"], clave, datos["nombre"], datos["rif"], datos["telefono"],
             datos.get("empresa"), datos.get("codigoCliente"), ahora_utc()),
        )
    elif cuenta["estado"] == "PENDIENTE_CORREO":
        # Nadie confirmo este correo: quien se registra de nuevo puede
        # corregir sus datos (y solo entra quien reciba el codigo).
        cur.execute(
            'UPDATE "CuentaPortal" SET "passwordHash" = %s, "nombre" = %s, "rif" = %s, "telefono" = %s, '
            '"empresaDeclarada" = %s, "codigoDeclarado" = %s WHERE "id" = %s',
            (clave, datos["nombre"], datos["rif"], datos["telefono"], datos.get("empresa"),
             datos.get("codigoCliente"), cuenta["id"]),
        )
        cuenta = {**cuenta, "nombre": datos["nombre"]}
    else:
        return
    enviar_codigo(cur, cuenta, CONFIRMAR)


def vincular_por_correo(cur, cuenta_id: str, email: str) -> int:
    """Vincula la cuenta con los clientes que tienen su correo registrado.
    Devuelve cuantos vinculo."""
    cur.execute(
        'INSERT INTO "CuentaPortalCliente" ("id", "cuentaId", "empresa", "codigoCliente", "origen", "vinculadoEn") '
        "SELECT 'cpc-' || substr(md5(random()::text || c.\"id\"), 1, 16), %s, c.\"empresa\", "
        "ltrim(c.\"codigo\", '0'), 'AUTO_CORREO', %s FROM \"Cliente\" c "
        'WHERE lower(trim(c."email")) = %s '
        'ON CONFLICT ("cuentaId", "empresa", "codigoCliente") DO NOTHING',
        (cuenta_id, ahora_utc(), email),
    )
    return cur.rowcount


def _activar_si_vinculada(cur, cuenta_id: str) -> str:
    cur.execute(
        "UPDATE \"CuentaPortal\" SET \"estado\" = 'ACTIVA' WHERE \"id\" = %s AND \"estado\" = 'POR_VALIDAR' "
        'AND EXISTS (SELECT 1 FROM "CuentaPortalCliente" WHERE "cuentaId" = %s) RETURNING "estado"',
        (cuenta_id, cuenta_id),
    )
    fila = cur.fetchone()
    if fila:
        return fila["estado"]
    cur.execute('SELECT "estado" FROM "CuentaPortal" WHERE "id" = %s', (cuenta_id,))
    return cur.fetchone()["estado"]


def _marcar_correo_confirmado(cur, cuenta: dict) -> None:
    cur.execute(
        "UPDATE \"CuentaPortal\" SET \"estado\" = 'POR_VALIDAR', \"correoVerificadoEn\" = %s "
        "WHERE \"id\" = %s AND \"estado\" = 'PENDIENTE_CORREO'",
        (ahora_utc(), cuenta["id"]),
    )
    vincular_por_correo(cur, cuenta["id"], cuenta["email"])
    _activar_si_vinculada(cur, cuenta["id"])


def confirmar(cur, email: str, codigo: str) -> dict:
    cuenta = _por_email(cur, email, bloquear=True)
    if not cuenta or cuenta["estado"] != "PENDIENTE_CORREO":
        raise HTTPException(400, "El código no es correcto o ya venció. Pide uno nuevo.")
    _usar_codigo(cur, cuenta, CONFIRMAR, codigo)
    _marcar_correo_confirmado(cur, cuenta)
    return cuenta


def reenviar(cur, email: str, proposito: str) -> None:
    cuenta = _por_email(cur, email, bloquear=True)
    if not cuenta or cuenta["estado"] == "SUSPENDIDA":
        return
    if proposito == CONFIRMAR and cuenta["estado"] != "PENDIENTE_CORREO":
        return
    enviar_codigo(cur, cuenta, proposito)


def autenticar(cur, email: str, password: str) -> dict:
    cuenta = _por_email(cur, email, bloquear=True)
    if cuenta is None:
        _cuenta_falsa_para_tiempo()
        raise HTTPException(401, "Correo o contraseña incorrectos")
    ahora = ahora_utc()
    if cuenta["bloqueadoHasta"] and cuenta["bloqueadoHasta"] > ahora:
        minutos = max(1, int((cuenta["bloqueadoHasta"] - ahora).total_seconds() // 60) + 1)
        raise HTTPException(429, f"Demasiados intentos fallidos. Intenta de nuevo en {minutos} minuto(s).")
    if not verify_password(password, cuenta["passwordHash"]):
        intentos = cuenta["intentosFallidos"] + 1
        bloqueo = ahora + timedelta(minutes=MINUTOS_BLOQUEO) if intentos >= INTENTOS_MAXIMOS else None
        cur.execute(
            'UPDATE "CuentaPortal" SET "intentosFallidos" = %s, "bloqueadoHasta" = %s WHERE "id" = %s',
            (0 if bloqueo else intentos, bloqueo, cuenta["id"]),
        )
        cur.connection.commit()
        raise HTTPException(401, "Correo o contraseña incorrectos")
    cur.execute(
        'UPDATE "CuentaPortal" SET "intentosFallidos" = 0, "bloqueadoHasta" = NULL WHERE "id" = %s', (cuenta["id"],)
    )
    # Recien con la clave correcta se dice por que no puede entrar.
    if cuenta["estado"] == "PENDIENTE_CORREO":
        cur.connection.commit()
        raise HTTPException(403, "CORREO_SIN_CONFIRMAR")
    if cuenta["estado"] == "SUSPENDIDA":
        cur.connection.commit()
        raise HTTPException(403, "Tu cuenta está suspendida. Comunícate con cobranzas.")
    return cuenta


def recuperar(cur, email: str) -> None:
    cuenta = _por_email(cur, email, bloquear=True)
    if not cuenta or cuenta["estado"] == "SUSPENDIDA":
        return
    enviar_codigo(cur, cuenta, RECUPERAR)


def cambiar_clave_con_codigo(cur, email: str, codigo: str, nueva: str) -> None:
    """Cambia la clave y cierra todas las sesiones abiertas. Si el correo no
    estaba confirmado, recibir este codigo tambien lo confirma."""
    cuenta = _por_email(cur, email, bloquear=True)
    if not cuenta or cuenta["estado"] == "SUSPENDIDA":
        raise HTTPException(400, "El código no es correcto o ya venció. Pide uno nuevo.")
    _usar_codigo(cur, cuenta, RECUPERAR, codigo)
    cur.execute(
        'UPDATE "CuentaPortal" SET "passwordHash" = %s, "intentosFallidos" = 0, "bloqueadoHasta" = NULL '
        'WHERE "id" = %s',
        (hash_password(nueva), cuenta["id"]),
    )
    cerrar_sesiones(cur, cuenta["id"])
    if cuenta["estado"] == "PENDIENTE_CORREO":
        _marcar_correo_confirmado(cur, cuenta)

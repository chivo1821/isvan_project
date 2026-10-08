"""Motorizados autogestionados.

Pedido del cliente (2026-10-07): los repartidores en moto rotan mucho y no
tiene sentido que alguien les cree un usuario a cada uno. Se registran solos:

- Registro: codigo de registro de la empresa (lo define el ADMIN, ver
  configuracion.TEXTOS) + nombre + placa + telefono + un PIN de 6 digitos.
  El codigo solo abre la puerta de registro; no sirve para entrar.
- Cada uno trae su moto (no es de la empresa) y la carga en el bolso que si
  entrega la empresa: al registrarse se crea su moto con la capacidad
  configurada (motoCapacidadKg) y CON refrigeracion (el bolso es termico;
  sin eso el planificador la descarta, porque todo lo que se reparte son
  helados), y queda asignada a el para siempre. La placa identifica a la
  persona.
- Entran con placa + PIN. Tras INTENTOS_MAXIMOS fallidos la cuenta queda
  bloqueada MINUTOS_BLOQUEO: el PIN es corto y el login es publico.
- El ADMIN los da de baja (no los borra: su historial de rutas y pagos se
  queda), los reactiva o les restablece el PIN si lo olvidan.

Por dentro es un usuario REPARTIDOR mas (autogestionado = true, sin
correo): permisos, choferes y pagos de delivery funcionan igual.
"""

from __future__ import annotations

import hmac
import re
import secrets
import uuid
from datetime import timedelta

from fastapi import HTTPException

from app.core.auth import hash_password, verify_password
from app.core.fechas import ahora_utc
from app.services import configuracion

ALMACEN_BASE_ID = "alm-catia"
INTENTOS_MAXIMOS = 5
MINUTOS_BLOQUEO = 15

# Prefijos moviles vigentes en Venezuela: Digitel 0412 y 0422 (desde julio
# de 2025), Movistar 0414 y 0424, Movilnet 0416 y 0426.
PREFIJOS_MOVILES = ("0412", "0414", "0416", "0422", "0424", "0426")

_PLACA = re.compile(r"[A-Z0-9]{5,8}")
_PIN = re.compile(r"\d{6}")


# ---------- Formatos ----------


def normalizar_placa(placa: str) -> str:
    """Mayusculas y sin espacios, guiones ni puntos: "ab-12 3cd" y "AB123CD"
    son la misma moto."""
    return re.sub(r"[\s.\-]", "", placa or "").upper()


def validar_placa(placa: str) -> str:
    normalizada = normalizar_placa(placa)
    if not _PLACA.fullmatch(normalizada):
        raise ValueError("La placa debe tener entre 5 y 8 letras o numeros")
    return normalizada


def validar_telefono(telefono: str) -> str:
    """Un movil venezolano en 11 digitos (04141234567). Acepta que venga con
    espacios, guiones o el +58 delante."""
    digitos = re.sub(r"\D", "", telefono or "")
    if digitos.startswith("58") and len(digitos) == 12:
        digitos = "0" + digitos[2:]
    if len(digitos) != 11 or digitos[:4] not in PREFIJOS_MOVILES:
        raise ValueError(
            "El telefono debe ser un movil venezolano de 11 digitos con prefijo " + ", ".join(PREFIJOS_MOVILES)
        )
    return digitos


def validar_pin(pin: str) -> str:
    """6 digitos, y ninguno de los que se adivinan primero: todos iguales
    (000000) o seguidos (123456, 654321)."""
    if not _PIN.fullmatch(pin or ""):
        raise ValueError("El PIN debe tener exactamente 6 digitos")
    digitos = [int(c) for c in pin]
    pasos = {b - a for a, b in zip(digitos, digitos[1:])}
    if pasos in ({0}, {1}, {-1}):
        raise ValueError("Ese PIN es muy facil de adivinar: no uses digitos repetidos ni seguidos")
    return pin


def pin_aleatorio() -> str:
    while True:
        pin = f"{secrets.randbelow(1_000_000):06d}"
        try:
            return validar_pin(pin)
        except ValueError:
            continue


# ---------- Registro ----------


def registrar(cur, *, codigo: str, nombre: str, placa: str, telefono: str, pin: str) -> dict:
    """Crea el motorizado y su moto. Devuelve la fila del usuario. Levanta
    HTTPException con un mensaje para mostrarle al motorizado."""
    vigente = configuracion.leer_texto(cur, "motorizadoCodigoRegistro")
    if not vigente:
        raise HTTPException(403, "El registro de motorizados no esta habilitado. Habla con el administrador.")
    # Comparacion en tiempo constante: el tiempo de respuesta no da pistas
    # de cuantos caracteres acertaste.
    if not hmac.compare_digest(codigo.strip().upper().encode(), vigente.upper().encode()):
        raise HTTPException(403, "El codigo de registro no es correcto")

    cur.execute('SELECT "id" FROM "Vehiculo" WHERE "placa" = %s', (placa,))
    if cur.fetchone():
        raise HTTPException(
            409,
            "Esa placa ya esta registrada. Si ya te registraste antes, entra con tu PIN; si no lo recuerdas, "
            "pide al administrador que te lo restablezca.",
        )

    capacidad = configuracion.leer(cur, "motoCapacidadKg")
    vehiculo_id = f"veh-{uuid.uuid4().hex[:10]}"
    usuario_id = f"usr-{uuid.uuid4().hex[:10]}"
    cur.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "tieneRefrigeracion", "estado", '
        '"almacenBaseId", "conductorNombre") VALUES (%s, %s, \'MOTO\', %s, true, \'FUNCIONAL\', %s, %s)',
        (vehiculo_id, placa, capacidad, ALMACEN_BASE_ID, nombre),
    )
    cur.execute(
        'INSERT INTO "Usuario" ("id", "nombre", "email", "passwordHash", "rol", "activo", "vehiculoAsignadoId", '
        '"autogestionado", "telefono", "pinHash") '
        "VALUES (%s, %s, NULL, %s, 'REPARTIDOR', true, %s, true, %s, %s) RETURNING *",
        # Sin contrasena: entra con PIN. La contrasena queda en un valor
        # aleatorio que nadie conoce (la columna es obligatoria).
        (usuario_id, nombre, hash_password(secrets.token_urlsafe(32)), vehiculo_id, telefono, hash_password(pin)),
    )
    return cur.fetchone()


# ---------- Entrada ----------

_MENSAJE_GENERICO = "Placa o PIN incorrectos"


def autenticar(cur, placa: str, pin: str) -> dict:
    """El usuario si la placa y el PIN son correctos. Cuenta los intentos
    fallidos y bloquea la cuenta al llegar a INTENTOS_MAXIMOS."""
    cur.execute(
        'SELECT u.* FROM "Usuario" u JOIN "Vehiculo" v ON v."id" = u."vehiculoAsignadoId" '
        'WHERE v."placa" = %s AND u."autogestionado" FOR UPDATE OF u',
        (normalizar_placa(placa),),
    )
    usuario = cur.fetchone()
    if not usuario or not usuario["pinHash"]:
        raise HTTPException(401, _MENSAJE_GENERICO)

    ahora = ahora_utc()
    if usuario["bloqueadoHasta"] and usuario["bloqueadoHasta"] > ahora:
        minutos = max(1, round((usuario["bloqueadoHasta"] - ahora).total_seconds() / 60))
        raise HTTPException(429, f"Demasiados intentos fallidos. Vuelve a intentar en {minutos} min.")

    if not verify_password(pin, usuario["pinHash"]):
        intentos = usuario["intentosFallidos"] + 1
        if intentos >= INTENTOS_MAXIMOS:
            cur.execute(
                'UPDATE "Usuario" SET "intentosFallidos" = 0, "bloqueadoHasta" = %s WHERE "id" = %s',
                (ahora + timedelta(minutes=MINUTOS_BLOQUEO), usuario["id"]),
            )
        else:
            cur.execute('UPDATE "Usuario" SET "intentosFallidos" = %s WHERE "id" = %s', (intentos, usuario["id"]))
        # Se guarda el intento aunque la respuesta sea un error.
        cur.connection.commit()
        raise HTTPException(401, _MENSAJE_GENERICO)

    # Con el PIN correcto ya no hay nada que esconder: se le dice por que
    # no puede entrar.
    if not usuario["activo"]:
        raise HTTPException(403, "Tu acceso esta dado de baja. Habla con el administrador.")

    cur.execute('UPDATE "Usuario" SET "intentosFallidos" = 0, "bloqueadoHasta" = NULL WHERE "id" = %s', (usuario["id"],))
    return usuario


# ---------- Administracion ----------


def obtener(cur, usuario_id: str) -> dict:
    cur.execute('SELECT * FROM "Usuario" WHERE "id" = %s AND "autogestionado"', (usuario_id,))
    usuario = cur.fetchone()
    if not usuario:
        raise HTTPException(404, "Motorizado no encontrado")
    return usuario


def dar_de_baja(cur, usuario: dict) -> None:
    """Sin acceso y fuera de la planificacion, pero sin borrar nada: sus
    rutas y pagos siguen en el historial."""
    cur.execute('UPDATE "Usuario" SET "activo" = false WHERE "id" = %s', (usuario["id"],))
    cur.execute('DELETE FROM "Sesion" WHERE "usuarioId" = %s', (usuario["id"],))
    if usuario["vehiculoAsignadoId"]:
        cur.execute(
            'UPDATE "Vehiculo" SET "estado" = \'FUERA_DE_SERVICIO\' WHERE "id" = %s', (usuario["vehiculoAsignadoId"],)
        )


def reactivar(cur, usuario: dict) -> None:
    cur.execute(
        'UPDATE "Usuario" SET "activo" = true, "intentosFallidos" = 0, "bloqueadoHasta" = NULL WHERE "id" = %s',
        (usuario["id"],),
    )
    if usuario["vehiculoAsignadoId"]:
        cur.execute('UPDATE "Vehiculo" SET "estado" = \'FUNCIONAL\' WHERE "id" = %s', (usuario["vehiculoAsignadoId"],))


def restablecer_pin(cur, usuario: dict) -> str:
    """Un PIN nuevo, que se muestra una sola vez al ADMIN. Destraba la cuenta
    y cierra las sesiones abiertas (si lo olvido, cualquier sesion vieja
    quiza no es suya)."""
    pin = pin_aleatorio()
    cur.execute(
        'UPDATE "Usuario" SET "pinHash" = %s, "intentosFallidos" = 0, "bloqueadoHasta" = NULL WHERE "id" = %s',
        (hash_password(pin), usuario["id"]),
    )
    cur.execute('DELETE FROM "Sesion" WHERE "usuarioId" = %s', (usuario["id"],))
    return pin


def tiene_historial(cur, usuario: dict) -> bool:
    cur.execute(
        'SELECT EXISTS (SELECT 1 FROM "Ruta" WHERE "vehiculoId" = %s) '
        'OR EXISTS (SELECT 1 FROM "LiquidacionDelivery" WHERE "repartidorId" = %s) AS "si"',
        (usuario["vehiculoAsignadoId"], usuario["id"]),
    )
    return cur.fetchone()["si"]


def eliminar(cur, usuario: dict) -> None:
    """Solo si nunca hizo nada (por ejemplo, un registro de prueba o
    duplicado). Con historial se da de baja."""
    if tiene_historial(cur, usuario):
        raise HTTPException(409, "Este motorizado ya tiene rutas o pagos registrados: dalo de baja en vez de eliminarlo")
    cur.execute('DELETE FROM "Sesion" WHERE "usuarioId" = %s', (usuario["id"],))
    cur.execute('DELETE FROM "Usuario" WHERE "id" = %s', (usuario["id"],))
    if usuario["vehiculoAsignadoId"]:
        cur.execute('DELETE FROM "Vehiculo" WHERE "id" = %s', (usuario["vehiculoAsignadoId"],))


def actualizar_capacidad_motos(cur, capacidad_kg: float) -> None:
    """El bolso de reparto es el mismo para todos: al cambiar el ajuste, las
    motos de los motorizados toman la capacidad nueva."""
    cur.execute(
        'UPDATE "Vehiculo" SET "capacidadKg" = %s WHERE "id" IN '
        '(SELECT "vehiculoAsignadoId" FROM "Usuario" WHERE "autogestionado" AND "vehiculoAsignadoId" IS NOT NULL)',
        (capacidad_kg,),
    )

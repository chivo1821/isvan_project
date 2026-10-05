"""Ajustes de la operacion que el ADMIN cambia desde la app, sin desplegar.

Se guardan en la tabla Configuracion como clave -> valor. Si una clave no
tiene fila, vale el valor por defecto de AJUSTES: la app funciona igual
aunque nadie haya tocado nada.
"""

from __future__ import annotations

from psycopg.types.json import Jsonb

from app.core.fechas import ahora_utc

# Cada ajuste con su valor por defecto y su rango valido.
AJUSTES: dict[str, dict] = {
    "motoDistanciaMaxKm": {
        "defecto": 25.0,
        "minimo": 1.0,
        "maximo": 200.0,
        "etiqueta": "Distancia máxima para motos",
        "descripcion": (
            "Una moto no se sugiere para un viaje con alguna parada a más de estos km del almacén "
            "(distancia por calle estimada). Si se le asigna a mano, la ruta muestra un aviso."
        ),
        "unidad": "km",
    },
}


def leer(cur, clave: str) -> float:
    ajuste = AJUSTES[clave]
    cur.execute('SELECT "valor" FROM "Configuracion" WHERE "clave" = %s', (clave,))
    fila = cur.fetchone()
    if fila is None:
        return ajuste["defecto"]
    try:
        return float(fila["valor"])
    except (TypeError, ValueError):
        return ajuste["defecto"]


def todos(cur) -> list[dict]:
    cur.execute(
        'SELECT c."clave", c."valor", c."actualizadoEn", u."nombre" AS "actualizadoPor" FROM "Configuracion" c '
        'LEFT JOIN "Usuario" u ON u."id" = c."actualizadoPorId"'
    )
    guardados = {f["clave"]: f for f in cur.fetchall()}
    salida = []
    for clave, ajuste in AJUSTES.items():
        fila = guardados.get(clave)
        salida.append({
            "clave": clave,
            "valor": float(fila["valor"]) if fila else ajuste["defecto"],
            "defecto": ajuste["defecto"],
            "minimo": ajuste["minimo"],
            "maximo": ajuste["maximo"],
            "etiqueta": ajuste["etiqueta"],
            "descripcion": ajuste["descripcion"],
            "unidad": ajuste["unidad"],
            "actualizadoEn": fila["actualizadoEn"] if fila else None,
            "actualizadoPor": fila["actualizadoPor"] if fila else None,
        })
    return salida


def guardar(cur, clave: str, valor: float, usuario_id: str) -> None:
    if clave not in AJUSTES:
        raise KeyError(clave)
    ajuste = AJUSTES[clave]
    if not (ajuste["minimo"] <= valor <= ajuste["maximo"]):
        raise ValueError(f"{ajuste['etiqueta']}: debe estar entre {ajuste['minimo']:g} y {ajuste['maximo']:g} {ajuste['unidad']}")
    cur.execute(
        'INSERT INTO "Configuracion" ("clave", "valor", "actualizadoEn", "actualizadoPorId") VALUES (%s, %s, %s, %s) '
        'ON CONFLICT ("clave") DO UPDATE SET "valor" = EXCLUDED."valor", "actualizadoEn" = EXCLUDED."actualizadoEn", '
        '"actualizadoPorId" = EXCLUDED."actualizadoPorId"',
        (clave, Jsonb(valor), ahora_utc(), usuario_id),
    )

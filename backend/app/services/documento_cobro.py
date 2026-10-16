"""Detalle de una factura o nota de entrega para cobranzas: sus productos
(las lineas del extracto de ventas), su despacho y la ruta en que se entrego,
y los pagos que la abonaron.

El despacho se encuentra por el numero de documento (Despacho.numeroDocumento)
y el cliente de destino (empresa + codigo sin ceros), el mismo cruce que usa
el bloqueo de despachos (cartera.estado_de_despachos).
"""

from __future__ import annotations

from app.core.conductor import CONDUCTOR_DEL_VEHICULO
from app.services import cartera


def detalle(cur, documento_id: str) -> dict | None:
    cur.execute(
        'SELECT "id", "empresa"::text AS "empresa", "tipoDoc", "numero", "codigoCliente", "fecha", "vencimiento", '
        '"montoUsd", "montoBs", "origen"::text AS "origen", "vigente" FROM "DocumentoCobro" WHERE "id" = %s',
        (documento_id,),
    )
    doc = cur.fetchone()
    if not doc:
        return None
    clave = (doc["empresa"], doc["codigoCliente"])
    p = cartera.parametros(cur)
    estado = cartera.estado_cliente(cur, *clave, p=p)
    saldo = next((d for d in estado.documentos if d.id == doc["id"]), None)
    datos = cartera.datos_clientes(cur, [clave]).get(clave) or {}

    # Lineas vigentes del extracto (carga confirmada y no reemplazada).
    cur.execute(
        'SELECT v."codigoProducto", COALESCE(pr."nombre", \'Producto \' || v."codigoProducto") AS "producto", '
        'pr."grupo", v."cajas", v."unidades", v."litros", v."montoBs", v."montoUsd" '
        'FROM "Venta" v JOIN "VentaCarga" c ON c."id" = v."cargaId" '
        'LEFT JOIN "VentaProducto" pr ON pr."empresa" = v."empresa" AND pr."codigo" = v."codigoProducto" '
        "WHERE c.\"estado\" = 'CONFIRMADA' AND v.\"reemplazadaPorCargaId\" IS NULL "
        'AND v."empresa" = %s AND v."codTipoDoc" = %s AND v."numDoc" = %s ORDER BY v."id"',
        (doc["empresa"], doc["tipoDoc"], doc["numero"]),
    )
    productos = [
        {
            "codigo": str(f["codigoProducto"]),
            "producto": f["producto"],
            "grupo": f["grupo"],
            "cajas": float(f["cajas"]),
            "unidades": f["unidades"],
            "litros": float(f["litros"]),
            "montoUsd": float(f["montoUsd"]),
            "montoBs": float(f["montoBs"]),
            "precioUnitarioUsd": float(f["montoUsd"]) / f["unidades"] if f["unidades"] else None,
        }
        for f in cur.fetchall()
    ]

    cur.execute(
        'SELECT d."id", d."numero", d."estado"::text AS "estado", d."fechaCreacion", d."llegadaEn", d."entregadoEn", '
        'r."numero" AS "ruta", r."estado"::text AS "estadoRuta", r."salidaProgramada", r."iniciadaEn", '
        f'r."completadaEn", v."placa", {CONDUCTOR_DEL_VEHICULO} AS "conductor" '
        'FROM "Despacho" d JOIN "Cliente" cl ON cl."id" = d."destinoClienteId" '
        'LEFT JOIN "Ruta" r ON r."id" = d."rutaId" LEFT JOIN "Vehiculo" v ON v."id" = r."vehiculoId" '
        "WHERE d.\"numeroDocumento\" = %s AND cl.\"empresa\" = %s AND ltrim(cl.\"codigo\", '0') = %s "
        'ORDER BY d."fechaCreacion" DESC LIMIT 1',
        (doc["numero"], doc["empresa"], doc["codigoCliente"]),
    )
    despacho = cur.fetchone()
    if despacho:
        cur.execute(
            'SELECT "descripcion", "cantidadSolicitada", "cantidad", "pesoUnitarioKg" FROM "DespachoItem" '
            'WHERE "despachoId" = %s ORDER BY "descripcion"',
            (despacho["id"],),
        )
        despacho["items"] = cur.fetchall()

    cur.execute(
        'SELECT p."id", p."numero", p."metodo"::text AS "metodo", p."estado"::text AS "estado", p."fechaPago", '
        'a."montoUsd", a."automatica" FROM "PagoAplicacion" a JOIN "Pago" p ON p."id" = a."pagoId" '
        'WHERE a."documentoId" = %s ORDER BY p."fechaPago", p."numero"',
        (doc["id"],),
    )
    abonos = [{**f, "montoUsd": float(f["montoUsd"])} for f in cur.fetchall()]

    resumen = saldo.como_dict(p.hoy) if saldo else None
    return {
        "id": doc["id"],
        "empresa": doc["empresa"],
        "codigoCliente": doc["codigoCliente"],
        "cliente": datos.get("nombre") or f"Cliente {doc['codigoCliente']}",
        "rutaComercial": datos.get("ruta"),
        "tipoDoc": doc["tipoDoc"],
        "numero": doc["numero"],
        "fecha": doc["fecha"],
        "origen": doc["origen"],
        "vigente": doc["vigente"],
        "montoUsd": float(doc["montoUsd"]),
        "montoBs": float(doc["montoBs"]),
        # Fuera de la cartera (anterior al inicio o carga revertida): sin
        # saldo ni vencimiento que mostrar.
        "enCartera": resumen is not None,
        "vence": resumen["vence"] if resumen else None,
        "abonadoUsd": resumen["abonadoUsd"] if resumen else None,
        "saldoUsd": resumen["saldoUsd"] if resumen else None,
        "estado": resumen["estado"] if resumen else None,
        "diasAtraso": resumen["diasAtraso"] if resumen else 0,
        "productos": productos,
        "despacho": despacho,
        "abonos": abonos,
    }

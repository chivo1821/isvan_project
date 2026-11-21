"""Pruebas Fase 4.3: Aislamiento multi-organizacion mediante RLS en PostgreSQL."""

from __future__ import annotations

import uuid

import psycopg
import pytest

from app.core import db as core_db

TABLAS_CON_ORGANIZACION_ID = (
    "AjusteInventario",
    "Almacen",
    "Bitacora",
    "Censo",
    "Cliente",
    "CuentaBancariaEmpresa",
    "CuentaPortal",
    "Despacho",
    "DocumentoCobro",
    "DocumentoVenta",
    "EmpresaFiscal",
    "Impuesto",
    "LiquidacionDelivery",
    "ListaPrecio",
    "ListaPrecioCarga",
    "MaestraCarga",
    "MaestraCliente",
    "MetaLitros",
    "MetaVenta",
    "MovimientoInventario",
    "Pago",
    "Pedido",
    "Producto",
    "Ruta",
    "TabuladorDelivery",
    "Tarea",
    "Usuario",
    "Vehiculo",
    "VendedorRuta",
    "Venta",
    "VentaCarga",
    "VentaCliente",
    "VentaProducto",
    "Visita",
)

TABLAS_SIN_ORGANIZACION_ID = (
    "DiaFeriado",
    "Configuracion",
    "GastoCarga",
    "Gasto",
)


@pytest.fixture()
def rol_no_superuser(db):
    """Crea un rol sin SUPERUSER ni BYPASSRLS dentro de la BD de pruebas.

    En PostgreSQL local `postgres` es SUPERUSER y omite incluso FORCE ROW LEVEL
    SECURITY; por eso las pruebas de cumplimiento real de RLS cambian a este rol
    mediante SET LOCAL ROLE dentro de la transaccion.
    """
    nombre_rol = f"rls_app_{uuid.uuid4().hex[:10]}"
    db.execute(f'CREATE ROLE "{nombre_rol}" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS')
    db.execute(f'GRANT USAGE ON SCHEMA public TO "{nombre_rol}"')
    db.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{nombre_rol}"')
    db.execute(f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "{nombre_rol}"')
    db.commit()
    try:
        yield nombre_rol
    finally:
        db.rollback()
        db.execute(f'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "{nombre_rol}"')
        db.execute(f'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "{nombre_rol}"')
        db.execute(f'REVOKE USAGE ON SCHEMA public FROM "{nombre_rol}"')
        db.execute(f'DROP ROLE IF EXISTS "{nombre_rol}"')
        db.commit()


@pytest.fixture()
def datos_dos_organizaciones(db, usuario):
    """Siembra filas equivalentes en 'org-principal' y 'org-b' como superusuario."""
    suf = uuid.uuid4().hex[:8]
    u_principal = usuario(rol="ADMIN")

    org_b = f"org-b-{suf}"
    u_b_id = f"usr-b-{suf}"
    alm_p_id = f"alm-p-{suf}"
    alm_b_id = f"alm-b-{suf}"
    emp_p_id = f"emp-p-{suf}"
    emp_b_id = f"emp-b-{suf}"
    cli_p_id = f"cli-p-{suf}"
    cli_b_id = f"cli-b-{suf}"
    prod_p_id = f"prod-p-{suf}"
    prod_b_id = f"prod-b-{suf}"
    ped_p_id = f"ped-p-{suf}"
    ped_b_id = f"ped-b-{suf}"
    carga_p_id = f"carga-p-{suf}"
    carga_b_id = f"carga-b-{suf}"

    db.execute(
        'INSERT INTO "Organizacion" ("id", "nombre") VALUES (%s, %s)',
        (org_b, "Organizacion B"),
    )
    db.execute(
        'INSERT INTO "Usuario" ("id", "organizacionId", "nombre", "email", "passwordHash", "rol") '
        "VALUES (%s, %s, %s, %s, %s, 'ADMIN')",
        (u_b_id, org_b, "Admin Org B", f"{u_b_id}@pruebas.test", "hash"),
    )
    db.execute(
        'INSERT INTO "EmpresaFiscal" ("id", "organizacionId", "codigo", "razonSocial") VALUES '
        "(%s, 'org-principal', %s, 'Empresa Principal Test'), "
        "(%s, %s, %s, 'Empresa Org B Test')",
        (emp_p_id, f"COD-P-{suf}", emp_b_id, org_b, f"COD-B-{suf}"),
    )
    db.execute(
        'INSERT INTO "Almacen" ("id", "organizacionId", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") VALUES '
        "(%s, 'org-principal', 'Almacen P', 'Planta', 'Dir P', 'Caracas', 10.5, -66.9), "
        "(%s, %s, 'Almacen B', 'Planta', 'Dir B', 'Valencia', 10.2, -68.0)",
        (alm_p_id, alm_b_id, org_b),
    )
    db.execute(
        'INSERT INTO "Cliente" ("id", "organizacionId", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "telefono") VALUES '
        "(%s, 'org-principal', 'ISVAN', %s, 'Cliente Principal', 'Tienda', 'Dir P', 'Caracas', '04140000001'), "
        "(%s, %s, 'ISVAN', %s, 'Cliente Org B', 'Tienda', 'Dir B', 'Valencia', '04140000002')",
        (cli_p_id, f"CLIP-{suf}", cli_b_id, org_b, f"CLIB-{suf}"),
    )
    db.execute(
        'INSERT INTO "Producto" ("id", "organizacionId", "empresaId", "codigo", "nombre") VALUES '
        "(%s, 'org-principal', %s, %s, 'Producto Principal'), "
        "(%s, %s, %s, %s, 'Producto Org B')",
        (
            prod_p_id,
            emp_p_id,
            int(suf, 16) % 100000 + 1000,
            prod_b_id,
            org_b,
            emp_b_id,
            int(suf, 16) % 100000 + 2000,
        ),
    )
    db.execute(
        'INSERT INTO "Pedido" ("id", "organizacionId", "empresaId", "numero", "clienteId", "almacenId", "creadoPorId") VALUES '
        "(%s, 'org-principal', %s, %s, %s, %s, %s), "
        "(%s, %s, %s, %s, %s, %s, %s)",
        (
            ped_p_id,
            emp_p_id,
            f"PED-P-{suf}",
            cli_p_id,
            alm_p_id,
            u_principal["id"],
            ped_b_id,
            org_b,
            emp_b_id,
            f"PED-B-{suf}",
            cli_b_id,
            alm_b_id,
            u_b_id,
        ),
    )
    db.execute(
        'INSERT INTO "VentaCarga" ("id", "organizacionId", "empresa", "archivo", "periodoDesde", "periodoHasta", "filas", "subidaPorId", "resumen", "dimensiones") VALUES '
        "(%s, 'org-principal', 'ISVAN', 'p.xlsx', '2026-11-01', '2026-11-01', 1, %s, '{}', '{}'), "
        "(%s, %s, 'ISVAN', 'b.xlsx', '2026-11-01', '2026-11-01', 1, %s, '{}', '{}')",
        (carga_p_id, u_principal["id"], carga_b_id, org_b, u_b_id),
    )
    db.execute(
        'INSERT INTO "Venta" ("organizacionId", "empresa", "cargaId", "fecha", "numDoc", "codTipoDoc", "tipoMovimiento", "codigoCliente", "codigoProducto", "cajas", "unidades", "litros", "montoBs", "montoUsd") VALUES '
        "('org-principal', 'ISVAN', %s, '2026-11-01', %s, 'FA', 'VENTA', 'C1', 1001, 1, 12, 1.0, 100, 10), "
        "(%s, 'ISVAN', %s, '2026-11-01', %s, 'FA', 'VENTA', 'C2', 1002, 2, 24, 2.0, 200, 20)",
        (carga_p_id, f"FA-P-{suf}", org_b, carga_b_id, f"FA-B-{suf}"),
    )
    db.commit()

    yield {
        "org_b": org_b,
        "emp_p_id": emp_p_id,
        "emp_b_id": emp_b_id,
        "cli_p_id": cli_p_id,
        "cli_b_id": cli_b_id,
        "prod_p_id": prod_p_id,
        "prod_b_id": prod_b_id,
        "ped_p_id": ped_p_id,
        "ped_b_id": ped_b_id,
        "carga_p_id": carga_p_id,
        "carga_b_id": carga_b_id,
        "num_doc_p": f"FA-P-{suf}",
        "num_doc_b": f"FA-B-{suf}",
        "suf": suf,
    }


def test_rls_habilitado_y_forzado_en_todas_las_tablas(db):
    tablas_esperadas = ("Organizacion", *TABLAS_CON_ORGANIZACION_ID)
    assert len(TABLAS_CON_ORGANIZACION_ID) == 34

    filas = db.execute(
        """
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY(%s)
        """,
        (list(tablas_esperadas),),
    ).fetchall()

    por_tabla = {f["relname"]: f for f in filas}
    assert set(por_tabla) == set(tablas_esperadas)
    for tabla in tablas_esperadas:
        assert por_tabla[tabla]["relrowsecurity"] is True, f"RLS no habilitado en {tabla}"
        assert por_tabla[tabla]["relforcerowsecurity"] is True, f"FORCE RLS no habilitado en {tabla}"

    politicas = db.execute(
        """
        SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY(%s)
        """,
        (list(tablas_esperadas),),
    ).fetchall()
    tablas_con_politica = {p["tablename"] for p in politicas}
    assert tablas_con_politica == set(tablas_esperadas)
    for p in politicas:
        assert p["cmd"] == "ALL"
        assert "app.organizacion_id" in (p["qual"] or "")
        assert "app.organizacion_id" in (p["with_check"] or "")

    columnas_excluidas = db.execute(
        """
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY(%s)
          AND column_name = 'organizacionId'
        """,
        (list(TABLAS_SIN_ORGANIZACION_ID),),
    ).fetchall()
    assert columnas_excluidas == []


def test_con_organizacion_valida_entrada_y_no_contamina_pool(base_url, db):
    with db.cursor() as cur:
        with pytest.raises(ValueError):
            core_db.con_organizacion(cur, "")
        with pytest.raises(ValueError):
            core_db.con_organizacion(cur, "   ")
        with pytest.raises(ValueError):
            core_db.con_organizacion(cur, None)  # type: ignore[arg-type]

    with core_db.get_connection() as conn:
        with conn.cursor() as cur:
            core_db.con_organizacion(cur, "org-prueba-pool")
            val = cur.execute("SELECT current_setting('app.organizacion_id', true) AS org").fetchone()
            assert val["org"] == "org-prueba-pool"

    with core_db.get_connection() as conn:
        with conn.cursor() as cur:
            val = cur.execute("SELECT NULLIF(current_setting('app.organizacion_id', true), '') AS org").fetchone()
            assert val["org"] is None


def test_rls_contexto_por_defecto_aisla_en_org_principal(db, rol_no_superuser, datos_dos_organizaciones):
    d = datos_dos_organizaciones
    with db.cursor() as cur:
        cur.execute(f'SET LOCAL ROLE "{rol_no_superuser}"')

        orgs = {r["id"] for r in cur.execute('SELECT "id" FROM "Organizacion"').fetchall()}
        assert "org-principal" in orgs
        assert d["org_b"] not in orgs

        emps = {r["id"] for r in cur.execute('SELECT "id" FROM "EmpresaFiscal"').fetchall()}
        assert d["emp_p_id"] in emps
        assert d["emp_b_id"] not in emps

        clientes = {r["id"] for r in cur.execute('SELECT "id" FROM "Cliente"').fetchall()}
        assert d["cli_p_id"] in clientes
        assert d["cli_b_id"] not in clientes

        productos = {r["id"] for r in cur.execute('SELECT "id" FROM "Producto"').fetchall()}
        assert d["prod_p_id"] in productos
        assert d["prod_b_id"] not in productos

        pedidos = {r["id"] for r in cur.execute('SELECT "id" FROM "Pedido"').fetchall()}
        assert d["ped_p_id"] in pedidos
        assert d["ped_b_id"] not in pedidos

        ventas = {r["numDoc"] for r in cur.execute('SELECT "numDoc" FROM "Venta"').fetchall()}
        assert d["num_doc_p"] in ventas
        assert d["num_doc_b"] not in ventas

        res_upd = cur.execute(
            'UPDATE "Cliente" SET "nombre" = \'Modificado\' WHERE "id" = %s',
            (d["cli_b_id"],),
        )
        assert res_upd.rowcount == 0

        res_del = cur.execute('DELETE FROM "Pedido" WHERE "id" = %s', (d["ped_b_id"],))
        assert res_del.rowcount == 0

        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                'INSERT INTO "EmpresaFiscal" ("id", "organizacionId", "codigo", "razonSocial") '
                "VALUES (%s, %s, %s, 'Intruso')",
                (f"emp-intruso-{d['suf']}", d["org_b"], f"INTR-{d['suf']}"),
            )


def test_rls_con_organizacion_aisla_org_b(db, rol_no_superuser, datos_dos_organizaciones):
    d = datos_dos_organizaciones
    org_b = d["org_b"]

    with db.cursor() as cur:
        cur.execute(f'SET LOCAL ROLE "{rol_no_superuser}"')
        core_db.con_organizacion(cur, org_b)

        orgs = {r["id"] for r in cur.execute('SELECT "id" FROM "Organizacion"').fetchall()}
        assert orgs == {org_b}

        emps = {r["id"] for r in cur.execute('SELECT "id" FROM "EmpresaFiscal"').fetchall()}
        assert emps == {d["emp_b_id"]}

        clientes = {r["id"] for r in cur.execute('SELECT "id" FROM "Cliente"').fetchall()}
        assert clientes == {d["cli_b_id"]}

        productos = {r["id"] for r in cur.execute('SELECT "id" FROM "Producto"').fetchall()}
        assert productos == {d["prod_b_id"]}

        pedidos = {r["id"] for r in cur.execute('SELECT "id" FROM "Pedido"').fetchall()}
        assert pedidos == {d["ped_b_id"]}

        ventas = {r["numDoc"] for r in cur.execute('SELECT "numDoc" FROM "Venta"').fetchall()}
        assert ventas == {d["num_doc_b"]}

        res_upd = cur.execute(
            'UPDATE "EmpresaFiscal" SET "razonSocial" = \'Hack\' WHERE "id" = %s',
            (d["emp_p_id"],),
        )
        assert res_upd.rowcount == 0

        res_del = cur.execute('DELETE FROM "Cliente" WHERE "id" = %s', (d["cli_p_id"],))
        assert res_del.rowcount == 0

        # Escritura valida dentro de org-b funciona
        with db.transaction():
            cur.execute(
                'INSERT INTO "EmpresaFiscal" ("id", "organizacionId", "codigo", "razonSocial") '
                "VALUES (%s, %s, %s, 'Empresa B Valida')",
                (f"emp-b-ok-{d['suf']}", org_b, f"OK-{d['suf']}"),
            )
            creada = cur.execute(
                'SELECT "id" FROM "EmpresaFiscal" WHERE "id" = %s',
                (f"emp-b-ok-{d['suf']}",),
            ).fetchone()
            assert creada is not None

        # Escritura con organizacionId distinto (o por defecto 'org-principal') falla WITH CHECK
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with db.transaction():
                cur.execute(
                    'INSERT INTO "EmpresaFiscal" ("id", "organizacionId", "codigo", "razonSocial") '
                    "VALUES (%s, 'org-principal', %s, 'Escape a principal')",
                    (f"emp-escape-{d['suf']}", f"ESC-{d['suf']}"),
                )

        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with db.transaction():
                cur.execute(
                    'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "telefono") '
                    "VALUES (%s, 'ISVAN', %s, 'Sin org explicita', 'Tienda', 'Dir', 'CCS', '04141111111')",
                    (f"cli-default-{d['suf']}", f"DEF-{d['suf']}"),
                )

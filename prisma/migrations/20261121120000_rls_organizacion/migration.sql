-- Aislamiento multi-organizacion mediante Row-Level Security (RLS).
--
-- Cuando la sesion/transaccion no fija app.organizacion_id (o la deja vacia),
-- COALESCE cae en 'org-principal', manteniendo compatibilidad transparente con
-- consultas, scripts y migraciones de una sola organizacion. Al fijar
-- set_config('app.organizacion_id', '<otra-org>', true) via db.con_organizacion(),
-- cada organizacion solo ve y modifica sus propias filas.

-- Organizacion (aislada por su propio "id")
ALTER TABLE "Organizacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organizacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Organizacion"
    USING ("id" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("id" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

-- Tablas con columna "organizacionId" (34 tablas)

ALTER TABLE "AjusteInventario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AjusteInventario" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "AjusteInventario"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Almacen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Almacen" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Almacen"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Bitacora" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Bitacora" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Bitacora"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Censo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Censo" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Censo"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Cliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cliente" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Cliente"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "CuentaBancariaEmpresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CuentaBancariaEmpresa" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "CuentaBancariaEmpresa"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "CuentaPortal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CuentaPortal" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "CuentaPortal"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Despacho" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Despacho" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Despacho"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "DocumentoCobro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentoCobro" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "DocumentoCobro"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "DocumentoVenta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentoVenta" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "DocumentoVenta"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "EmpresaFiscal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmpresaFiscal" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "EmpresaFiscal"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Impuesto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Impuesto" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Impuesto"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "LiquidacionDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LiquidacionDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "LiquidacionDelivery"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "ListaPrecio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ListaPrecio" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "ListaPrecio"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "ListaPrecioCarga" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ListaPrecioCarga" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "ListaPrecioCarga"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "MaestraCarga" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaestraCarga" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "MaestraCarga"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "MaestraCliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaestraCliente" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "MaestraCliente"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "MetaLitros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MetaLitros" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "MetaLitros"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "MetaVenta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MetaVenta" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "MetaVenta"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "MovimientoInventario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MovimientoInventario" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "MovimientoInventario"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Pago" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pago" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Pago"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Pedido" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pedido" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Pedido"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Producto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Producto" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Producto"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Ruta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ruta" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Ruta"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "TabuladorDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TabuladorDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "TabuladorDelivery"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Tarea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tarea" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Tarea"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Usuario" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Usuario"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Vehiculo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehiculo" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Vehiculo"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "VendedorRuta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VendedorRuta" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "VendedorRuta"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Venta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Venta" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Venta"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "VentaCarga" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VentaCarga" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "VentaCarga"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "VentaCliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VentaCliente" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "VentaCliente"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "VentaProducto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VentaProducto" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "VentaProducto"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "Visita" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Visita" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aislamiento_organizacion" ON "Visita"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

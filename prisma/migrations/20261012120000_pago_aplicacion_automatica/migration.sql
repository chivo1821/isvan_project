-- Un pago verificado sin documentos elegidos se reparte solo a lo que vence
-- primero, y ese reparto queda guardado como aplicaciones marcadas
-- automaticas (ver backend/app/services/pagos.py, reparto_automatico).
ALTER TABLE "PagoAplicacion" ADD COLUMN "automatica" BOOLEAN NOT NULL DEFAULT false;

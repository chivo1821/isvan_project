-- Documentos de cobro creados por el sistema administrativo al emitir.
-- Va sola: un valor nuevo de enum no se usa en la misma transaccion que lo crea.
ALTER TYPE "OrigenDocumento" ADD VALUE IF NOT EXISTS 'SISTEMA';

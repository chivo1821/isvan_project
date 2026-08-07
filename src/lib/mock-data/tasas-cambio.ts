// MOCK DATA — reemplazar en Fase 2 por el feed real del BCV.
// Tasa oficial (Bs por USD) por fecha. Venta y Factura "congelan" la tasa
// vigente el dia que se registran (campo tasaBcv) para que su equivalente en
// Bs no cambie despues, aunque el monto en USD siga siendo el valor
// canonico para comparar entre fechas.
import { TASA_BCV_VES_POR_USD } from "@/lib/constants";
import type { TasaCambio } from "./types";

export const tasasCambio: TasaCambio[] = [
  { id: "tc-1", fecha: "2026-05-01", tasa: 178.2 },
  { id: "tc-2", fecha: "2026-05-10", tasa: 179.85 },
  { id: "tc-3", fecha: "2026-06-01", tasa: 183.4 },
  { id: "tc-4", fecha: "2026-06-10", tasa: 185.1 },
  { id: "tc-5", fecha: "2026-06-15", tasa: 186.05 },
  { id: "tc-6", fecha: "2026-07-15", tasa: 191.3 },
  { id: "tc-7", fecha: "2026-07-20", tasa: 192.6 },
  { id: "tc-8", fecha: "2026-07-25", tasa: 193.9 },
  { id: "tc-9", fecha: "2026-07-28", tasa: 194.7 },
  { id: "tc-10", fecha: "2026-07-29", tasa: 194.95 },
  { id: "tc-11", fecha: "2026-07-30", tasa: 195.2 },
  { id: "tc-12", fecha: "2026-07-31", tasa: 195.65 },
  { id: "tc-13", fecha: "2026-08-04", tasa: 196.1 },
  { id: "tc-14", fecha: "2026-08-05", tasa: 196.3 },
  { id: "tc-15", fecha: "2026-08-06", tasa: 196.55 },
  { id: "tc-16", fecha: "2026-08-07", tasa: TASA_BCV_VES_POR_USD },
];

export function getTasaByFecha(fecha: string): number {
  return tasasCambio.find((t) => t.fecha === fecha)?.tasa ?? TASA_BCV_VES_POR_USD;
}

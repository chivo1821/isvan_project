// Bancos de Venezuela por su código de 4 dígitos. Misma lista que
// backend/app/services/bancos.py (la API valida contra la suya).

export const BANCOS: { codigo: string; nombre: string }[] = [
  { codigo: "0102", nombre: "Banco de Venezuela" },
  { codigo: "0104", nombre: "Venezolano de Crédito" },
  { codigo: "0105", nombre: "Mercantil" },
  { codigo: "0108", nombre: "BBVA Provincial" },
  { codigo: "0114", nombre: "Bancaribe" },
  { codigo: "0115", nombre: "Banco Exterior" },
  { codigo: "0128", nombre: "Banco Caroní" },
  { codigo: "0134", nombre: "Banesco" },
  { codigo: "0137", nombre: "Sofitasa" },
  { codigo: "0138", nombre: "Banco Plaza" },
  { codigo: "0146", nombre: "Bangente" },
  { codigo: "0151", nombre: "BFC Banco Fondo Común" },
  { codigo: "0156", nombre: "100% Banco" },
  { codigo: "0157", nombre: "DelSur" },
  { codigo: "0163", nombre: "Banco del Tesoro" },
  { codigo: "0166", nombre: "Banco Agrícola de Venezuela" },
  { codigo: "0168", nombre: "Bancrecer" },
  { codigo: "0169", nombre: "R4 Banco Microfinanciero" },
  { codigo: "0171", nombre: "Banco Activo" },
  { codigo: "0172", nombre: "Bancamiga" },
  { codigo: "0173", nombre: "Banco Internacional de Desarrollo" },
  { codigo: "0174", nombre: "Banplus" },
  { codigo: "0175", nombre: "Banco Digital de los Trabajadores" },
  { codigo: "0177", nombre: "BANFANB" },
  { codigo: "0178", nombre: "N58 Banco Digital" },
  { codigo: "0191", nombre: "Banco Nacional de Crédito (BNC)" },
];

const POR_CODIGO = new Map(BANCOS.map((b) => [b.codigo, b.nombre]));

export function nombreBanco(codigo: string | null | undefined): string | null {
  return codigo ? (POR_CODIGO.get(codigo) ?? null) : null;
}

/** El banco de una cuenta de 20 dígitos (sus 4 primeros), si ya se escribió. */
export function bancoDeCuenta(cuenta: string): string | null {
  const digitos = cuenta.replace(/\D/g, "");
  return digitos.length >= 4 ? nombreBanco(digitos.slice(0, 4)) : null;
}

/** "0134 0001 2300 1234 5678" para leer una cuenta de 20 dígitos. */
export function formatCuenta(cuenta: string | null | undefined): string {
  if (!cuenta) return "";
  return cuenta.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");
}

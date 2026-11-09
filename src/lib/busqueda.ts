/** Búsqueda de texto en listas: sin mayúsculas ni acentos, por palabras
 * (todas tienen que aparecer, en cualquier campo y en cualquier orden) y sin
 * ceros a la izquierda en los números: «575», «0575» y «FA 575» encuentran el
 * cliente 0575 y la factura 575. */

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_./#]/g, " ");
}

/** Cada palabra del texto, y la de solo dígitos también sin sus ceros a la
 * izquierda. */
function palabras(texto: string): string[] {
  return normalizar(texto)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((p) => (/^\d+$/.test(p) ? [p, p.replace(/^0+(?=\d)/, "")] : [p]));
}

export function coincideBusqueda(consulta: string, campos: (string | null | undefined)[]): boolean {
  const buscadas = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (buscadas.length === 0) return true;
  const texto = normalizar(campos.filter(Boolean).join(" "));
  const sueltas = palabras(campos.filter(Boolean).join(" "));
  return buscadas.every((b) => {
    if (texto.includes(b)) return true;
    // «0575» busca la palabra 575 y al revés.
    if (/^\d+$/.test(b)) {
      const sinCeros = b.replace(/^0+(?=\d)/, "");
      return sueltas.some((p) => p === sinCeros || p.replace(/^0+(?=\d)/, "").startsWith(sinCeros));
    }
    return false;
  });
}

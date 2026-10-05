/** Las etiquetas, ayudas y opciones del formulario traen un poco de HTML de
 * Survey123 (negritas, colores) que el importador ya limpió: solo formato y
 * color (ver limpiar_html en backend/app/services/xlsform.py). Sin
 * "use client": lo usan tanto el formulario como el detalle del censo. */
export function HtmlLimpio({ html, className }: { html?: string; className?: string }) {
  if (!html) return null;
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function textoPlano(html?: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

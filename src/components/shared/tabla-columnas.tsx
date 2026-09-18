/** Qué columna del archivo se tomó para cada dato, con ejemplos: lo primero
 * que conviene comprobar cuando un Excel viene sin encabezado y las columnas
 * se reconocieron por su contenido. La usan la carga de ventas y la
 * importación de despachos. */
export type ColumnaLeida = {
  campo: string;
  /** Letra de la columna en Excel. */
  columna: string;
  /** Título de la columna; null si el archivo vino sin encabezado. */
  encabezado: string | null;
  ejemplos: string[];
};

export function TablaColumnas({ columnas }: { columnas: ColumnaLeida[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">Col.</th>
            <th className="px-2 py-1.5 font-medium">Dato</th>
            <th className="px-2 py-1.5 font-medium">Ejemplos del archivo</th>
          </tr>
        </thead>
        <tbody>
          {columnas.map((c) => (
            <tr key={c.columna} className="border-t border-border">
              <td className="px-2 py-1.5 font-medium text-foreground tabular-nums">{c.columna}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-foreground">
                {c.campo}
                {c.encabezado && <span className="text-muted-foreground"> («{c.encabezado}»)</span>}
              </td>
              <td className="max-w-72 truncate px-2 py-1.5 text-muted-foreground" title={c.ejemplos.join(" · ")}>
                {c.ejemplos.join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

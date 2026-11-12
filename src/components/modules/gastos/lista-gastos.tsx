import Link from "@/components/shared/enlace";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBs, formatNumero, formatUsd } from "@/lib/constants";
import { formatFecha } from "@/lib/indicadores";
import { enlaceGastos, type FiltrosGastos, type ListaGastos as Lista } from "@/lib/gastos";

export function ListaGastos({ datos, filtros }: { datos: Lista; filtros: FiltrosGastos }) {
  return (
    <div className="min-w-0 space-y-3">
      {datos.categorias.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={!filtros.categoria ? "default" : "outline"} asChild>
            <Link href={enlaceGastos(filtros, { categoria: undefined })}>Todas</Link>
          </Button>
          {datos.categorias.map((c) => (
            <Button key={c} size="sm" variant={filtros.categoria === c ? "default" : "outline"} asChild>
              <Link href={enlaceGastos(filtros, { categoria: c })}>{c}</Link>
            </Button>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {formatNumero(datos.total)} gasto(s) por {formatUsd(datos.totalUsd, 2)}
        {datos.total > datos.limite && ` · se muestran los ${formatNumero(datos.limite)} más recientes`}
      </p>

      {datos.gastos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No hay gastos cargados en este período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                {filtros.empresa === "TODAS" && <TableHead>Empresa</TableHead>}
                <TableHead>Categoría</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead className="text-right">Bs</TableHead>
                <TableHead className="text-right">Tasa</TableHead>
                <TableHead className="text-right">USD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datos.gastos.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="whitespace-nowrap">{formatFecha(g.fecha)}</TableCell>
                  {filtros.empresa === "TODAS" && <TableCell>{g.empresa}</TableCell>}
                  <TableCell className="whitespace-nowrap">{g.categoria}</TableCell>
                  <TableCell className="max-w-72">
                    <span className="block truncate" title={g.descripcion ?? undefined}>
                      {g.descripcion ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-48">
                    <span className="block truncate" title={g.proveedor ?? undefined}>
                      {g.proveedor ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{g.referencia ?? "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {g.montoBs != null ? formatBs(g.montoBs) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {g.tasa != null ? formatNumero(g.tasa, 2) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {formatUsd(g.montoUsd, 2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

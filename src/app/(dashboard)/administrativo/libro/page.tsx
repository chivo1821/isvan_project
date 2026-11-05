import { DownloadIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SelectorEmpresa } from "@/components/modules/administrativo/comunes";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_URL, apiGet } from "@/lib/api-client";
import { formatBs, formatDate } from "@/lib/constants";
import { hoyCaracas } from "@/lib/indicadores";
import { empresaElegida, parametro, type EmpresaFiscal, type FilaLibro, type SearchParams } from "@/lib/administrativo";

const COLUMNAS: [keyof FilaLibro, string][] = [
  ["totalBs", "Total con IVA"], ["exentoBs", "Exento"], ["baseGeneral", "Base 16 %"], ["ivaGeneral", "IVA 16 %"],
  ["baseReducida", "Base 8 %"], ["ivaReducida", "IVA 8 %"], ["igtfBs", "IGTF"], ["retencionIvaBs", "IVA retenido"],
];

export default async function LibroPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const empresas = await apiGet<EmpresaFiscal[]>("/empresas");
  const empresa = empresaElegida(empresas, params);
  if (!empresa) return null;
  const mes = (parametro(params, "mes") ?? hoyCaracas().slice(0, 7)).slice(0, 7);
  const filas = await apiGet<FilaLibro[]>(`/ventas/libro?empresaId=${empresa.id}&mes=${mes}-01`);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Libro de ventas"
        subtitle="Facturas y notas de crédito y débito emitidas en el mes, con base e IVA por alícuota. Las notas de entrega no van al libro."
        actions={
          <>
            <form className="flex items-center gap-2">
              <input type="hidden" name="empresa" value={empresa.id} />
              <input type="month" name="mes" defaultValue={mes} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Mes" />
              <Button type="submit" variant="outline" size="sm">Ver</Button>
            </form>
            <SelectorEmpresa empresas={empresas} actual={empresa.id} />
            <Button asChild variant="outline">
              <a href={`${API_URL}/ventas/libro.xlsx?empresaId=${empresa.id}&mes=${mes}-01`}><DownloadIcon />Excel</a>
            </Button>
          </>
        }
      />
      {filas.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay documentos emitidos en {mes}.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead><TableHead>Documento</TableHead><TableHead>Control</TableHead><TableHead>RIF</TableHead><TableHead>Razón social</TableHead>
                {COLUMNAS.map(([, t]) => <TableHead key={t} className="text-right">{t}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((f) => (
                <TableRow key={`${f.tipo}-${f.numero}`}>
                  <TableCell className="whitespace-nowrap">{formatDate(f.fecha)}</TableCell>
                  <TableCell className="whitespace-nowrap">{f.numero}{f.documentoAfectado && <span className="block text-xs text-muted-foreground">sobre {f.documentoAfectado}</span>}</TableCell>
                  <TableCell>{f.numeroControl}</TableCell>
                  <TableCell className="whitespace-nowrap">{f.rif}</TableCell>
                  <TableCell>{f.razonSocial}</TableCell>
                  {COLUMNAS.map(([c]) => <TableCell key={c} className="text-right tabular-nums">{formatBs(Number(f[c]))}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5} className="font-semibold">Totales</TableCell>
                {COLUMNAS.map(([c]) => (
                  <TableCell key={c} className="text-right font-semibold tabular-nums">{formatBs(filas.reduce((s, f) => s + Number(f[c]), 0))}</TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}

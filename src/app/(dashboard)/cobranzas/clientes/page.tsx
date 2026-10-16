import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api-client";
import type { ClienteCartera } from "@/lib/cobranzas";
import { formatDate, formatUsd } from "@/lib/constants";
import { cn } from "@/lib/utils";

const ESTADOS = [
  { valor: "con_saldo", label: "Con saldo" },
  { valor: "vencidos", label: "Con deuda vencida" },
  { valor: "bloqueados", label: "Bloqueados" },
  { valor: "al_dia", label: "Al día" },
  { valor: "todos", label: "Todos" },
] as const;
const TRAMO = 100;

function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default async function CobranzasClientesPage({ searchParams }: PageProps<"/cobranzas/clientes">) {
  const params = await searchParams;
  const leer = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const estado = ESTADOS.find((e) => e.valor === leer("estado"))?.valor ?? "con_saldo";
  const empresa = ["ISVAN", "TRALOG"].includes(leer("empresa")) ? leer("empresa") : "";
  const q = leer("q").trim().slice(0, 60);
  const mostrar = Math.min(Math.max(Number(leer("n")) || TRAMO, TRAMO), 5000);

  const todos = await apiGet<ClienteCartera[]>(`/cobranzas/clientes?estado=${estado}${empresa ? `&empresa=${empresa}` : ""}`);
  const buscado = normalizar(q);
  const filtrados = q
    ? todos.filter((c) => normalizar(`${c.nombre} ${c.codigoCliente} ${c.ruta ?? ""}`).includes(buscado))
    : todos;
  const visibles = filtrados.slice(0, mostrar);
  const enlace = (cambios: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ estado, empresa, q, ...cambios }).filter(([, v]) => v));
    return `/cobranzas/clientes?${p}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        subtitle="Saldo, deuda vencida y estado para despacho de cada cliente. Ordenados por deuda vencida."
        helpText="Un cliente queda bloqueado para despacho si tiene alguna factura o nota de entrega vencida (pasados los días de tolerancia). Se puede aprobar un despacho como excepción."
      />
      <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        {ESTADOS.map((e) => (
          <Link
            key={e.valor}
            href={enlace({ estado: e.valor, n: "" })}
            aria-current={estado === e.valor ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors",
              estado === e.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
            )}
          >
            {e.label}
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="estado" value={estado} />
        <div className="space-y-1.5">
          <Label htmlFor="empresa">Empresa</Label>
          <select id="empresa" name="empresa" defaultValue={empresa} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
            <option value="">Ambas</option>
            <option value="ISVAN">ISVAN</option>
            <option value="TRALOG">TRALOG</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q">Buscar</Label>
          <Input id="q" name="q" defaultValue={q} placeholder="Nombre, código o ruta" className="w-64 bg-card" />
        </div>
        <Button type="submit" variant="secondary">
          <SearchIcon aria-hidden />
          Buscar
        </Button>
      </form>

      <Card>
        <CardContent>
          <p className="mb-2 text-sm text-muted-foreground">
            {filtrados.length} cliente(s){filtrados.length > visibles.length && `, se muestran ${visibles.length}`}
          </p>
          {visibles.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay clientes en esta lista.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Ruta</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Vencido</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Atraso</TableHead>
                  <TableHead className="hidden lg:table-cell">Próx. vencimiento</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((c) => (
                  <TableRow key={`${c.empresa}:${c.codigoCliente}`}>
                    <TableCell>
                      <Link
                        href={`/cobranzas/clientes/${c.empresa}/${encodeURIComponent(c.codigoCliente)}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {c.nombre}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {c.empresa} {c.codigoCliente}
                        {c.pagosPorVerificar > 0 && ` · ${c.pagosPorVerificar} pago(s) por verificar`}
                        {c.cuentasPortal > 0 && " · usa el portal"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{c.ruta ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(c.saldoUsd, 2)}
                      {c.aFavorUsd > 0 && <span className="block text-xs text-success">a favor {formatUsd(c.aFavorUsd, 2)}</span>}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", c.vencidoUsd > 0 && "font-semibold text-destructive")}>
                      {formatUsd(c.vencidoUsd, 2)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{c.diasAtraso ? `${c.diasAtraso} días` : "—"}</TableCell>
                    <TableCell className="hidden tabular-nums lg:table-cell">{c.proximoVencimiento ? formatDate(c.proximoVencimiento) : "—"}</TableCell>
                    <TableCell>
                      {c.bloqueado ? (
                        <StatusBadge label="Bloqueado" tone="destructive" />
                      ) : c.saldoUsd > 0 ? (
                        <StatusBadge label="Con saldo" tone="warning" />
                      ) : (
                        <StatusBadge label="Al día" tone="success" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {filtrados.length > visibles.length && (
            <div className="mt-4 text-center">
              <Button variant="outline" asChild>
                <Link href={enlace({ n: String(mostrar + TRAMO) })} scroll={false}>
                  Mostrar {Math.min(TRAMO, filtrados.length - visibles.length)} más
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

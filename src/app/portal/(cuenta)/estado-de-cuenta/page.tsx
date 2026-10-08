import { DownloadIcon, FilterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImprimirButton } from "@/components/modules/portal/imprimir-button";
import { MovimientosTabla } from "@/components/modules/portal/movimientos-tabla";
import { API_URL, apiGet } from "@/lib/api-client";
import { claveCliente, hoyCaracas, type EstadoDeCuenta } from "@/lib/cobranzas";
import { formatDate } from "@/lib/constants";
import { getCuentaActiva } from "@/lib/portal";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export default async function PortalEstadoCuentaPage({ searchParams }: PageProps<"/portal/estado-de-cuenta">) {
  const cuenta = await getCuentaActiva();
  if (!cuenta) return null;
  const params = await searchParams;
  const leer = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const desde = FECHA.test(leer("desde")) ? leer("desde") : "";
  const hasta = FECHA.test(leer("hasta")) ? leer("hasta") : "";
  const cliente = cuenta.clientes.some((c) => claveCliente(c) === leer("cliente")) ? leer("cliente") : "";
  const query = new URLSearchParams(
    Object.entries({ desde, hasta, cliente }).filter(([, v]) => v) as [string, string][]
  ).toString();
  const estado = await apiGet<EstadoDeCuenta>(`/portal/estado-cuenta${query ? `?${query}` : ""}`);
  const nombres = new Map(cuenta.clientes.map((c) => [claveCliente(c), c.nombre]));
  const varios = cuenta.clientes.length > 1 && !cliente;
  const titular = cliente ? nombres.get(cliente) : cuenta.nombre;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Estado de cuenta</h1>
          <p className="text-sm text-muted-foreground">
            {titular} · {desde ? formatDate(desde) : "desde el inicio"} a {formatDate(hasta || hoyCaracas())} · USD
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" asChild>
            <a href={`${API_URL}/portal/estado-cuenta.xlsx${query ? `?${query}` : ""}`}>
              <DownloadIcon aria-hidden />
              Descargar Excel
            </a>
          </Button>
          <ImprimirButton />
        </div>
      </div>

      {/* Formulario GET: funciona sin JavaScript y deja el filtro en la URL. */}
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 print:hidden">
        <div className="space-y-1.5">
          <Label htmlFor="desde">Desde</Label>
          <Input id="desde" name="desde" type="date" defaultValue={desde} max={hoyCaracas()} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hasta">Hasta</Label>
          <Input id="hasta" name="hasta" type="date" defaultValue={hasta} max={hoyCaracas()} className="w-40" />
        </div>
        {cuenta.clientes.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="cliente">Cliente</Label>
            <select
              id="cliente"
              name="cliente"
              defaultValue={cliente}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Todos</option>
              {cuenta.clientes.map((c) => (
                <option key={claveCliente(c)} value={claveCliente(c)}>
                  {c.nombre} ({c.empresa})
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" variant="secondary">
          <FilterIcon aria-hidden />
          Ver
        </Button>
      </form>

      <Card>
        <CardContent>
          <MovimientosTabla
            estado={estado}
            conSaldoInicial={Boolean(desde)}
            nombreCliente={varios ? (e, c) => nombres.get(`${e}:${c}`) : undefined}
          />
        </CardContent>
      </Card>
    </>
  );
}

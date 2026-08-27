"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageSearchIcon, RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { NumberedCard } from "@/components/shared/numbered-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TIPO_VEHICULO_META } from "@/lib/constants";
import type { Cliente, Despacho, Ruta } from "@/lib/mock-data";

type DespachoConCliente = Despacho & { destinoCliente: Cliente };
type SugerenciaVehiculo = {
  vehiculo: { id: string; placa: string; tipo: string };
  holguraKg: number;
  motivos: string[];
};

function pesoTotal(despacho: Despacho) {
  return despacho.items.reduce((sum, item) => sum + item.cantidad * item.pesoUnitarioKg, 0);
}

export function NuevaRutaWizard({
  despachos,
  creadoPorId,
}: {
  despachos: DespachoConCliente[];
  creadoPorId: string;
}) {
  const router = useRouter();
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [buscando, setBuscando] = useState(false);
  const [sugerencias, setSugerencias] = useState<SugerenciaVehiculo[] | null>(null);
  const [vehiculoId, setVehiculoId] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  function alternar(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSugerencias(null);
    setVehiculoId(null);
  }

  async function buscarVehiculos() {
    if (seleccionados.size === 0) return;
    setBuscando(true);
    setVehiculoId(null);
    try {
      const data = await apiPost<SugerenciaVehiculo[]>("/rutas/vehiculos-sugeridos", {
        despachoIds: [...seleccionados],
      });
      setSugerencias(data);
      if (data.length === 0) {
        toast.info("No hay vehículos disponibles que cumplan la capacidad o refrigeración requeridas");
      }
    } catch (err) {
      toast.error("No se pudo buscar vehículos sugeridos", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBuscando(false);
    }
  }

  async function crearRuta() {
    if (seleccionados.size === 0 || !vehiculoId) return;
    setCreando(true);
    try {
      const ruta = await apiPost<Ruta>("/rutas", {
        despachoIds: [...seleccionados],
        vehiculoId,
        creadoPorId,
      });
      toast.success(`Ruta ${ruta.numero} creada`, {
        description: `${ruta.despachos.length} parada(s) · ${ruta.distanciaTotalKm?.toLocaleString("es-VE")} km estimados.`,
      });
      router.push(`/rutas/${ruta.id}`);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo crear la ruta", {
        description: err instanceof Error ? err.message : undefined,
      });
      setCreando(false);
    }
  }

  const despachosSeleccionados = despachos.filter((d) => seleccionados.has(d.id));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <NumberedCard
          number={1}
          title="Despachos a incluir"
          helpText="Solo se listan despachos ya aprobados que todavía no forman parte de una ruta."
        >
          {despachos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <PackageSearchIcon className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No hay despachos aprobados disponibles para armar una ruta en este momento.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Despacho</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Peso est.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {despachos.map((d) => (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => alternar(d.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={seleccionados.has(d.id)} onCheckedChange={() => alternar(d.id)} />
                      </TableCell>
                      <TableCell className="font-medium">{d.numero}</TableCell>
                      <TableCell>
                        {d.destinoCliente.nombre}
                        <span className="ml-1 text-xs text-muted-foreground">({d.destinoCliente.ciudad})</span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {pesoTotal(d).toLocaleString("es-VE")} kg
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </NumberedCard>

        <NumberedCard
          number={2}
          title="Vehículo"
          helpText="Se sugiere el vehículo con mejor ajuste de capacidad para el peso total de los despachos elegidos."
        >
          <div className="space-y-3">
            <Button onClick={buscarVehiculos} disabled={seleccionados.size === 0 || buscando} variant="outline">
              {buscando ? "Buscando..." : "Buscar vehículos sugeridos"}
            </Button>

            {sugerencias && sugerencias.length > 0 && (
              <div className="space-y-2">
                {sugerencias.map((s, index) => (
                  <div
                    key={s.vehiculo.id}
                    className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        {index === 0 && <StatusBadge tone="success" label="Recomendado" />}
                        <span className="font-medium text-foreground">{s.vehiculo.placa}</span>
                        <span className="text-sm text-muted-foreground">
                          {TIPO_VEHICULO_META[s.vehiculo.tipo as keyof typeof TIPO_VEHICULO_META].label}
                        </span>
                      </div>
                      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {s.motivos.map((motivo) => (
                          <li key={motivo}>✓ {motivo}</li>
                        ))}
                      </ul>
                    </div>
                    <Button
                      size="sm"
                      variant={vehiculoId === s.vehiculo.id ? "secondary" : "outline"}
                      onClick={() => setVehiculoId(s.vehiculo.id)}
                    >
                      {vehiculoId === s.vehiculo.id ? "Elegido" : "Elegir"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </NumberedCard>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <NumberedCard number={3} title="Confirmar ruta" helpText="Se calcula el orden de paradas y el trazado desde Almacén Catia.">
          {despachosSeleccionados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <RouteIcon className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Aún no elegiste despachos</p>
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">{despachosSeleccionados.length} parada(s)</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {despachosSeleccionados.map((d) => (
                  <li key={d.id}>
                    {d.numero} — {d.destinoCliente.nombre}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button
            className="mt-4 w-full"
            disabled={seleccionados.size === 0 || !vehiculoId || creando}
            onClick={crearRuta}
          >
            <RouteIcon />
            {creando ? "Creando ruta..." : "Crear ruta"}
          </Button>
        </NumberedCard>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, LocateFixedIcon, MapPinIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, mensajeDeError } from "@/lib/api-client";
import { MapaVisitas } from "@/components/modules/vendedor/mapa-visitas";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatHora } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  ESTATUS_VISITA_META,
  type ClienteDeLaSemana,
  type EstatusVisita,
  type Visita,
  type VisitasSemana,
} from "@/lib/vendedor";

// Mismo umbral que el rendimiento del dashboard
// (DISTANCIA_MAX_AL_CLIENTE_M en backend/app/api/vendedor.py).
const DISTANCIA_LEJOS_M = 300;
const ESTATUS: EstatusVisita[] = ["por_visitar", "en_cliente", "atendido"];

const claveCliente = (empresa: string, codigo: string) => `${empresa}|${codigo}`;

class ErrorUbicacion extends Error {}

/** La única toma de GPS de la visita, al empezarla. Alta precisión y sin
 * caché: una posición vieja no probaría que el vendedor está en el cliente. */
function ubicacionActual(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new ErrorUbicacion("Este navegador no permite obtener la ubicación."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) =>
        reject(
          new ErrorUbicacion(
            error.code === error.PERMISSION_DENIED
              ? "La app no tiene permiso para usar tu ubicación. Actívalo en la configuración del navegador (el candado junto a la dirección) y vuelve a intentar."
              : error.code === error.TIMEOUT
                ? "El GPS tardó demasiado en responder. Revisa que la ubicación del teléfono esté activada e intenta de nuevo."
                : "No se pudo obtener tu ubicación. Revisa que el GPS esté activado."
          )
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

export function VisitasVendedor({ inicial }: { inicial: VisitasSemana }) {
  const [datos, setDatos] = useState(inicial);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<EstatusVisita | "todos">("todos");
  const [busqueda, setBusqueda] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorGps, setErrorGps] = useState<string | null>(null);

  const abierta = datos.visitaAbierta ?? null;
  const porClave = new Map(datos.clientes.map((c) => [claveCliente(c.empresa, c.codigo), c]));
  const clienteAbierto = abierta ? porClave.get(claveCliente(abierta.empresa, abierta.codigoCliente)) : undefined;
  const elegido = seleccion ? porClave.get(seleccion) : undefined;

  const texto = busqueda.trim().toLowerCase();
  const visibles = datos.clientes.filter(
    (c) =>
      (filtro === "todos" || c.estatus === filtro) &&
      (!texto || c.nombre.toLowerCase().includes(texto) || c.codigo.toLowerCase().includes(texto))
  );

  async function recargar() {
    setDatos(await apiGet<VisitasSemana>("/vendedor/visitas/semana"));
  }

  function elegir(cliente: ClienteDeLaSemana) {
    setErrorGps(null);
    setSeleccion(claveCliente(cliente.empresa, cliente.codigo));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function iniciar(cliente: ClienteDeLaSemana) {
    setEnviando(true);
    setErrorGps(null);
    try {
      const posicion = await ubicacionActual();
      const visita = await apiPost<Visita>("/vendedor/visitas", {
        empresa: cliente.empresa,
        codigoCliente: cliente.codigo,
        lat: posicion.coords.latitude,
        lng: posicion.coords.longitude,
        precisionM: Math.round(posicion.coords.accuracy),
      });
      toast.success(`Visita a ${cliente.nombre} iniciada`, {
        description:
          visita.distanciaClienteM != null ? `Estás a ~${visita.distanciaClienteM} m del cliente.` : undefined,
      });
      setSeleccion(null);
      await recargar();
    } catch (err) {
      const motivo = mensajeDeError(err, "No se pudo iniciar la visita");
      if (err instanceof ErrorUbicacion) setErrorGps(motivo);
      toast.error("No se pudo iniciar la visita", { description: motivo });
    } finally {
      setEnviando(false);
    }
  }

  async function terminar() {
    if (!abierta) return;
    setEnviando(true);
    try {
      await apiPost<Visita>(`/vendedor/visitas/${abierta.id}/salida`, { observaciones });
      toast.success(`Visita a ${clienteAbierto?.nombre ?? abierta.codigoCliente} terminada`);
      setObservaciones("");
      await recargar();
    } catch (err) {
      toast.error("No se pudo terminar la visita", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {ESTATUS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setFiltro(filtro === e ? "todos" : e)}
            className={cn(
              "rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40",
              filtro === e && "border-primary ring-1 ring-primary/30"
            )}
          >
            <p className="text-2xl font-bold text-foreground">
              {datos.clientes.filter((c) => c.estatus === e).length}
            </p>
            <p className="text-xs text-muted-foreground">{ESTATUS_VISITA_META[e].label}</p>
          </button>
        ))}
      </div>

      {abierta && (
        <Card className="border-info/50 bg-info/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPinIcon className="size-4 text-info" />
              En el cliente: {clienteAbierto?.nombre ?? abierta.codigoCliente}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Llegaste a las {formatHora(abierta.llegadaEn)}
              {abierta.distanciaClienteM != null && ` · a ~${abierta.distanciaClienteM} m del cliente`}
            </p>
            {abierta.distanciaClienteM != null && abierta.distanciaClienteM > DISTANCIA_LEJOS_M && (
              <p className="flex items-start gap-2 text-xs text-warning">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                Tu ubicación quedó lejos de la del cliente en el maestro. Si de verdad estás ahí, explícalo en las
                observaciones.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="observaciones-visita">Observaciones</Label>
              <Textarea
                id="observaciones-visita"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={4}
                placeholder="Qué pasó en la visita: pedido, exhibición, reclamos, próxima visita..."
              />
            </div>
            <Button onClick={terminar} disabled={enviando} className="w-full sm:w-auto">
              <CheckCircle2Icon />
              {enviando ? "Guardando..." : "Terminar visita"}
            </Button>
          </CardContent>
        </Card>
      )}

      {elegido && !abierta && (
        <Card className="border-primary/40">
          <CardContent className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground">{elegido.nombre}</p>
              <p className="text-xs text-muted-foreground">
                Cód. {elegido.codigo} · Ruta {elegido.ruta}
                {elegido.lat == null && " · sin ubicación en el maestro: no se medirá la distancia"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSeleccion(null)} disabled={enviando}>
                Cancelar
              </Button>
              <Button onClick={() => iniciar(elegido)} disabled={enviando} className="flex-1 sm:flex-none">
                <LocateFixedIcon />
                {enviando ? "Tomando ubicación..." : "Llegué, empezar visita"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {errorGps && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{errorGps}</span>
        </p>
      )}

      <MapaVisitas clientes={datos.clientes} onElegir={abierta ? undefined : elegir} />

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar cliente por nombre o código"
          className="pl-8"
        />
      </div>

      {abierta && (
        <p className="text-xs text-muted-foreground">Termina la visita en curso para empezar otra.</p>
      )}

      {visibles.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Ningún cliente coincide con el filtro.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visibles.map((c) => {
            const ultima = c.visitas[c.visitas.length - 1];
            return (
              <li key={claveCliente(c.empresa, c.codigo)}>
                <button
                  type="button"
                  onClick={() => elegir(c)}
                  disabled={abierta !== null || c.estatus === "en_cliente"}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{c.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      Cód. {c.codigo} · Ruta {c.ruta}
                      {ultima &&
                        ` · ${ultima.salidaEn ? "atendido" : "llegada"} ${formatDate(ultima.llegadaEn)} ${formatHora(
                          ultima.salidaEn ?? ultima.llegadaEn
                        )}`}
                    </p>
                  </div>
                  <StatusBadge {...ESTATUS_VISITA_META[c.estatus]} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CameraIcon, CrosshairIcon, ImageIcon, Loader2Icon, LocateFixedIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { comprimirFoto, ErrorFoto } from "@/lib/formulario/comprimir";
import type { Valor } from "@/lib/formulario/expresiones";
import type { Opcion, Pregunta } from "@/lib/formulario/motor";
import { cn } from "@/lib/utils";
import { CamaraDialog, usarCamaraDelNavegador } from "./camara-dialog";
import { HtmlLimpio, textoPlano } from "./html-limpio";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />,
});
const PuntoElegible = dynamic(() => import("@/components/map/punto-elegible").then((m) => m.PuntoElegible), {
  ssr: false,
});
const FlyTo = dynamic(() => import("@/components/map/fly-to").then((m) => m.FlyTo), { ssr: false });

const tiene = (p: Pregunta, apariencia: string) => (p.appearance ?? "").split(/\s+/).includes(apariencia);

// ---------- Selección ----------

function claveOpcion(o: Opcion) {
  return `${o.name}|${JSON.stringify(o.extra)}`;
}

function SeleccionUna({
  pregunta,
  opciones,
  valor,
  onCambio,
  deshabilitado,
}: {
  pregunta: Pregunta;
  opciones: Opcion[];
  valor: Valor;
  onCambio: (v: Valor) => void;
  deshabilitado: boolean;
}) {
  const elegida = opciones.find((o) => o.name === valor) ?? null;
  if (tiene(pregunta, "autocomplete") || tiene(pregunta, "minimal")) {
    return (
      <Combobox
        items={opciones}
        value={elegida}
        onValueChange={(o) => onCambio(o ? o.name : null)}
        itemToStringLabel={(o) => textoPlano(o.label)}
        isItemEqualToValue={(a, b) => claveOpcion(a) === claveOpcion(b)}
        disabled={deshabilitado}
      >
        <ComboboxInput placeholder="Escribe para buscar…" showClear={!!elegida} className="w-full" />
        <ComboboxContent>
          <ComboboxEmpty>Sin coincidencias</ComboboxEmpty>
          <ComboboxList>
            {(o: Opcion) => (
              <ComboboxItem key={claveOpcion(o)} value={o}>
                {textoPlano(o.label)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    );
  }
  // horizontal: en fila; sin apariencia: una debajo de la otra (como Survey123).
  return (
    <div role="radiogroup" className={cn("flex gap-2", tiene(pregunta, "horizontal") ? "flex-wrap" : "flex-col items-start")}>
      {opciones.map((o) => {
        const activa = o.name === valor;
        return (
          <button
            key={claveOpcion(o)}
            type="button"
            role="radio"
            aria-checked={activa}
            disabled={deshabilitado}
            onClick={() => onCambio(activa && !pregunta.required ? null : o.name)}
            className={cn(
              "min-h-10 rounded-md border px-3.5 py-2 text-sm transition-colors disabled:opacity-50",
              activa
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-muted"
            )}
          >
            <HtmlLimpio html={o.label} />
          </button>
        );
      })}
    </div>
  );
}

function SeleccionVarias({
  pregunta,
  opciones,
  valor,
  onCambio,
  deshabilitado,
}: {
  pregunta: Pregunta;
  opciones: Opcion[];
  valor: Valor;
  onCambio: (v: Valor) => void;
  deshabilitado: boolean;
}) {
  const elegidas = Array.isArray(valor) ? valor : [];
  function alternar(nombre: string) {
    const nuevas = elegidas.includes(nombre) ? elegidas.filter((n) => n !== nombre) : [...elegidas, nombre];
    // En el orden de la lista, no en el del toque: así el valor es estable.
    onCambio(opciones.map((o) => o.name).filter((n) => nuevas.includes(n)));
  }
  return (
    <div className={cn("flex gap-2", tiene(pregunta, "horizontal") ? "flex-wrap" : "flex-col items-start")}>
      {opciones.map((o) => {
        const activa = elegidas.includes(o.name);
        return (
          <button
            key={claveOpcion(o)}
            type="button"
            aria-pressed={activa}
            disabled={deshabilitado}
            onClick={() => alternar(o.name)}
            className={cn(
              "flex min-h-10 items-center gap-2 rounded-md border px-3.5 py-2 text-sm transition-colors disabled:opacity-50",
              activa ? "border-primary bg-primary/10 text-foreground" : "border-input bg-background hover:bg-muted"
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px] leading-none",
                activa ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"
              )}
              aria-hidden
            >
              {activa ? "✓" : ""}
            </span>
            <HtmlLimpio html={o.label} />
          </button>
        );
      })}
    </div>
  );
}

// ---------- Ubicación ----------

type Punto = { lat: number; lng: number; precision?: number };
const CENTRO_CARACAS: [number, number] = [10.49, -66.88];

function CampoUbicacion({ valor, onCambio, deshabilitado }: { valor: Valor; onCambio: (v: Valor) => void; deshabilitado: boolean }) {
  const punto = valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Punto) : null;
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  function usarGps() {
    if (!navigator.geolocation) {
      setAviso("Este navegador no permite obtener la ubicación. Toca tu ubicación en el mapa.");
      return;
    }
    setBuscando(true);
    setAviso(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscando(false);
        onCambio({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: Math.round(pos.coords.accuracy) });
      },
      (error) => {
        setBuscando(false);
        setAviso(
          error.code === error.PERMISSION_DENIED
            ? "La app no tiene permiso para usar tu ubicación. Actívalo en el navegador o toca tu ubicación en el mapa."
            : "No se pudo obtener la ubicación del GPS. Revisa que esté activado, o toca tu ubicación en el mapa."
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={usarGps} disabled={deshabilitado || buscando}>
          {buscando ? <Loader2Icon className="animate-spin" /> : <LocateFixedIcon />}
          {buscando ? "Buscando…" : "Usar mi ubicación"}
        </Button>
        {punto && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {punto.lat.toFixed(6)}, {punto.lng.toFixed(6)}
            {punto.precision != null && ` · precisión ±${punto.precision} m`}
          </span>
        )}
      </div>
      {aviso && <p className="text-xs text-destructive">{aviso}</p>}
      <div className="relative">
        <LeafletMap center={punto ? [punto.lat, punto.lng] : CENTRO_CARACAS} zoom={punto ? 17 : 12} className="h-64">
          <PuntoElegible
            punto={punto}
            onElegir={(lat, lng) => !deshabilitado && onCambio({ lat, lng })}
          />
          <FlyTo target={punto ? [punto.lat, punto.lng] : null} zoom={17} />
        </LeafletMap>
        {!punto && (
          <p className="pointer-events-none absolute inset-x-0 bottom-2 z-[400] mx-auto flex w-fit items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
            <CrosshairIcon className="size-3.5" /> Toca tu ubicación en el mapa
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- Foto ----------

function CampoFoto({
  archivo,
  onArchivo,
  deshabilitado,
}: {
  archivo: File | null;
  onArchivo: (f: File | null) => void;
  deshabilitado: boolean;
}) {
  const id = useId();
  const [preparando, setPreparando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [camara, setCamara] = useState(false);
  const inputCamara = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);

  // En un celular, el input con capture abre la cámara nativa; en una
  // computadora lo ignora y abre la carpeta, así que ahí se usa la cámara
  // del navegador (ver camara-dialog.tsx).
  function tomarFoto() {
    if (usarCamaraDelNavegador()) setCamara(true);
    else inputCamara.current?.click();
  }

  async function elegir(original: File | null | undefined) {
    if (!original) return;
    setPreparando(true);
    setAviso(null);
    try {
      const foto = await comprimirFoto(original);
      if (vista) URL.revokeObjectURL(vista);
      setVista(URL.createObjectURL(foto));
      onArchivo(foto);
    } catch (e) {
      setAviso(e instanceof ErrorFoto ? e.message : "No se pudo preparar la foto.");
    } finally {
      setPreparando(false);
    }
  }

  function quitar() {
    if (vista) URL.revokeObjectURL(vista);
    setVista(null);
    onArchivo(null);
  }

  return (
    <div className="space-y-2">
      {archivo && vista ? (
        <div className="flex items-end gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), no pasa por next/image */}
          <img src={vista} alt="Vista previa de la foto" className="h-32 w-auto rounded-md border object-cover" />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground tabular-nums">{Math.round(archivo.size / 1024)} KB</span>
            <Button type="button" variant="outline" size="sm" onClick={quitar} disabled={deshabilitado}>
              <Trash2Icon /> Quitar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={tomarFoto} disabled={deshabilitado || preparando}>
            {preparando ? <Loader2Icon className="animate-spin" /> : <CameraIcon />}
            {preparando ? "Preparando…" : "Tomar foto"}
          </Button>
          <Button type="button" variant="ghost" asChild disabled={deshabilitado || preparando}>
            <label htmlFor={`${id}-galeria`} className="cursor-pointer">
              <ImageIcon /> Elegir de la galería
            </label>
          </Button>
          <input
            ref={inputCamara}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void elegir(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            id={`${id}-galeria`}
            ref={inputGaleria}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              void elegir(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {aviso && <p className="text-xs text-destructive">{aviso}</p>}
      <CamaraDialog
        abierta={camara}
        onAbierta={setCamara}
        onFoto={(f) => void elegir(f)}
        onSinCamara={() => inputGaleria.current?.click()}
      />
    </div>
  );
}

// ---------- Una pregunta ----------

export function Campo({
  pregunta: p,
  opciones,
  valor,
  error,
  onCambio,
  archivo,
  onArchivo,
}: {
  pregunta: Pregunta;
  opciones: Opcion[];
  valor: Valor;
  error?: string;
  onCambio: (v: Valor) => void;
  archivo: File | null;
  onArchivo: (f: File | null) => void;
}) {
  const id = useId();
  const [verGuia, setVerGuia] = useState(false);
  const deshabilitado = p.readonly;

  let control: React.ReactNode = null;
  switch (p.type) {
    case "select_one":
      control = <SeleccionUna pregunta={p} opciones={opciones} valor={valor} onCambio={onCambio} deshabilitado={deshabilitado} />;
      break;
    case "select_multiple":
      control = <SeleccionVarias pregunta={p} opciones={opciones} valor={valor} onCambio={onCambio} deshabilitado={deshabilitado} />;
      break;
    case "geopoint":
      control = <CampoUbicacion valor={valor} onCambio={onCambio} deshabilitado={deshabilitado} />;
      break;
    case "image":
      control = (
        <CampoFoto
          archivo={archivo}
          onArchivo={(f) => {
            onArchivo(f);
            onCambio(f ? f.name : null);
          }}
          deshabilitado={deshabilitado}
        />
      );
      break;
    case "integer":
    case "decimal":
      control = (
        <Input
          id={id}
          inputMode={p.type === "integer" ? "numeric" : "decimal"}
          value={valor === null || valor === undefined ? "" : String(valor)}
          onChange={(e) => {
            const texto = e.target.value.trim();
            const numero = Number(texto);
            onCambio(texto === "" ? null : Number.isFinite(numero) && /^-?\d+([.,]\d+)?$/.test(texto) ? numero : texto);
          }}
          disabled={deshabilitado}
          className="max-w-40"
        />
      );
      break;
    case "time":
      control = (
        <Input id={id} type="time" value={typeof valor === "string" ? valor : ""} onChange={(e) => onCambio(e.target.value || null)} disabled={deshabilitado} className="max-w-40" />
      );
      break;
    case "date":
      control = (
        <Input id={id} type="date" value={typeof valor === "string" ? valor : ""} onChange={(e) => onCambio(e.target.value || null)} disabled={deshabilitado} className="max-w-48" />
      );
      break;
    case "note":
      control = null;
      break;
    default:
      control = tiene(p, "multiline") ? (
        <Textarea
          id={id}
          value={typeof valor === "string" ? valor : ""}
          onChange={(e) => onCambio(e.target.value || null)}
          maxLength={p.field_length}
          disabled={deshabilitado}
        />
      ) : (
        <Input
          id={id}
          value={typeof valor === "string" ? valor : ""}
          onChange={(e) => onCambio(e.target.value || null)}
          maxLength={p.field_length}
          disabled={deshabilitado}
        />
      );
  }

  return (
    <div className="space-y-2" data-pregunta={p.name}>
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium">
          <HtmlLimpio html={p.label ?? p.name} />
          {p.required && (
            <span className="ml-0.5 text-destructive" aria-label="obligatorio">
              *
            </span>
          )}
        </label>
        {p.hint && <HtmlLimpio html={p.hint} className="block text-xs text-muted-foreground" />}
        {p.guidance_hint && (
          <div>
            <button type="button" onClick={() => setVerGuia((v) => !v)} className="text-xs text-primary underline-offset-4 hover:underline">
              {verGuia ? "Ocultar guía" : "Ver guía"}
            </button>
            {verGuia && <HtmlLimpio html={p.guidance_hint} className="mt-1 block rounded-md bg-muted/60 p-2 text-sm [&_h3]:text-base [&_h3]:font-medium" />}
          </div>
        )}
      </div>
      {control}
      {p.field_length && (p.type === "text" || !p.type) && typeof valor === "string" && (
        <p className="text-right text-xs text-muted-foreground tabular-nums">
          {valor.length} / {p.field_length}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

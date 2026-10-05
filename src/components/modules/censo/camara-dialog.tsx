"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraIcon,
  Loader2Icon,
  RefreshCwIcon,
  SwitchCameraIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** ¿Conviene la cámara del navegador en vez del selector de archivos? En un
 * celular o tablet, el input con `capture` ya abre la cámara nativa (mejor
 * foto: enfoque, flash). En una computadora `capture` se ignora y abre la
 * carpeta: ahí hace falta getUserMedia. Necesita HTTPS (o localhost). */
export function usarCamaraDelNavegador(): boolean {
  if (
    typeof window === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    !window.isSecureContext
  )
    return false;
  return !window.matchMedia("(pointer: coarse)").matches;
}

function mensajeDeErrorCamara(e: unknown): string {
  const nombre = e instanceof DOMException ? e.name : "";
  if (nombre === "NotAllowedError" || nombre === "SecurityError")
    return "El navegador no tiene permiso para usar la cámara. Permítelo en el candado de la barra de direcciones y vuelve a intentar.";
  if (nombre === "NotFoundError" || nombre === "OverconstrainedError")
    return "No se encontró ninguna cámara en este equipo.";
  if (nombre === "NotReadableError")
    return "La cámara está en uso por otra aplicación. Ciérrala y vuelve a intentar.";
  return "No se pudo abrir la cámara.";
}

/** Toma una foto con la cámara del equipo (webcam o cámara trasera) y la
 * devuelve como archivo JPEG, igual que si se hubiera elegido de la carpeta. */
export function CamaraDialog({
  abierta,
  onAbierta,
  onFoto,
  onSinCamara,
}: {
  abierta: boolean;
  onAbierta: (v: boolean) => void;
  onFoto: (archivo: File) => void;
  /** Si no hay cámara o no hay permiso, para ofrecer elegir un archivo. */
  onSinCamara: () => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [flujo, setFlujo] = useState<MediaStream | null>(null);
  const [lista, setLista] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frontal, setFrontal] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!abierta) return;
    let cancelado = false;
    let propio: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: frontal ? "user" : "environment", width: { ideal: 2560 }, height: { ideal: 1440 } },
      })
      .then((stream) => {
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        propio = stream;
        setFlujo(stream);
      })
      .catch((e) => !cancelado && setError(mensajeDeErrorCamara(e)));
    return () => {
      cancelado = true;
      propio?.getTracks().forEach((t) => t.stop());
      setFlujo(null);
    };
  }, [abierta, frontal, intento]);

  // El video se conecta al flujo cuando existen los dos, en el orden que
  // lleguen: el diálogo puede montar el <video> después de que la cámara
  // respondió, o al revés.
  const conectarVideo = useCallback(
    (v: HTMLVideoElement | null) => {
      video.current = v;
      if (v && flujo && v.srcObject !== flujo) {
        v.srcObject = flujo;
        void v.play().catch(() => undefined);
      }
    },
    [flujo]
  );

  // El estado se reinicia en los eventos (no dentro del efecto): al cerrar,
  // al reintentar y al cambiar de cámara.
  function reiniciar() {
    setLista(false);
    setError(null);
  }

  function cerrar(v: boolean) {
    if (!v) reiniciar();
    onAbierta(v);
  }

  function capturar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const lienzo = document.createElement("canvas");
    lienzo.width = v.videoWidth;
    lienzo.height = v.videoHeight;
    lienzo.getContext("2d")?.drawImage(v, 0, 0);
    lienzo.toBlob(
      (blob) => {
        if (!blob) {
          setError("No se pudo tomar la foto. Vuelve a intentar.");
          return;
        }
        onFoto(
          new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" }),
        );
        cerrar(false);
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <Dialog open={abierta} onOpenChange={cerrar}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tomar foto</DialogTitle>
          <DialogDescription>Encuadra y presiona «Capturar».</DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="space-y-3 rounded-lg border p-4 text-sm">
            <p>{error}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  reiniciar();
                  setIntento((n) => n + 1);
                }}
              >
                <RefreshCwIcon /> Reintentar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  cerrar(false);
                  onSinCamara();
                }}
              >
                Elegir un archivo
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video
              ref={conectarVideo}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => setLista(true)}
              className="aspect-video w-full object-contain"
            />
            {!lista && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                <Loader2Icon className="mr-2 size-4 animate-spin" /> Abriendo la
                cámara…
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reiniciar();
              setFrontal((f) => !f);
            }}
            disabled={!!error}
          >
            <SwitchCameraIcon /> Cambiar cámara
          </Button>
          <Button type="button" onClick={capturar} disabled={!lista || !!error}>
            <CameraIcon /> Capturar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

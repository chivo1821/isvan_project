/**
 * Control de calidad de las fotos del censo, en el teléfono, antes de subir.
 *
 * Tope pedido por el cliente: 10 MB por foto (FOTO_MAXIMA_BYTES, el mismo
 * que valida y firma el servidor en backend/app/api/censo.py). Para no
 * acercarse sin necesidad, cada foto se lleva a 2560 px de lado mayor y JPEG
 * al 85 %: un serial o una fachada se siguen leyendo bien y la foto queda en
 * 1-2,5 MB (una de cámara sin tocar pesa 3-8 MB, y el censo manda hasta
 * cuatro por datos móviles). Si aun así pasara del tope, se baja la calidad
 * por pasos; si ni con eso entra, se rechaza.
 *
 * Volver a codificar además endereza la foto (la orientación del EXIF) y le
 * quita los metadatos de la cámara.
 *
 * Memoria: una foto de 108 MP abierta completa ocupa unos 430 MB, y en un
 * teléfono eso puede cerrar la pestaña (y perder el censo). Por eso primero
 * se leen sus medidas, sin abrirla, y se le pide al navegador la imagen ya
 * reducida. Si el navegador no la entrega con la forma esperada (alguno
 * aplica la reducción antes de enderezarla), se abre completa como antes.
 */

export const FOTO_MAXIMA_BYTES = 10_000_000;
const LADO_MAXIMO = 2560;
const CALIDADES = [0.85, 0.72, 0.6];

export class ErrorFoto extends Error {}

const enMb = (bytes: number) => (bytes / 1_000_000).toLocaleString("es-VE", { maximumFractionDigits: 1 });

/** Ancho y alto de la foto ya enderezada, sin decodificarla: el evento
 * load de una imagen fuera de la página llega con solo leer la cabecera. */
async function medidas(archivo: File): Promise<{ ancho: number; alto: number } | null> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("imagen"));
      img.src = url;
    });
    return img.naturalWidth && img.naturalHeight ? { ancho: img.naturalWidth, alto: img.naturalHeight } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** La foto como imagen dibujable, ya reducida a LADO_MAXIMO si se puede. */
async function abrirReducida(archivo: File): Promise<ImageBitmap> {
  const m = await medidas(archivo);
  const escala = m ? Math.min(1, LADO_MAXIMO / Math.max(m.ancho, m.alto)) : 1;
  if (m && escala < 1) {
    const ancho = Math.round(m.ancho * escala);
    const alto = Math.round(m.alto * escala);
    try {
      const reducida = await createImageBitmap(archivo, { resizeWidth: ancho, resizeHeight: alto, resizeQuality: "high" });
      // Misma forma que la foto enderezada: si no, quedaría deformada.
      if (Math.abs(reducida.width / reducida.height - m.ancho / m.alto) < 0.02) return reducida;
      reducida.close();
    } catch {
      // Se intenta abajo con la foto completa.
    }
  }
  return createImageBitmap(archivo);
}

export async function comprimirFoto(archivo: File): Promise<File> {
  let imagen: ImageBitmap;
  try {
    imagen = await abrirReducida(archivo);
  } catch {
    // Formatos que el navegador no sabe dibujar (HEIC fuera de Safari): se
    // manda tal cual si entra en el tope y es de un tipo que el servidor acepta.
    if (archivo.size <= FOTO_MAXIMA_BYTES && ["image/jpeg", "image/png", "image/webp"].includes(archivo.type)) {
      return archivo;
    }
    throw new ErrorFoto("No se pudo leer la foto. Tómala de nuevo con la cámara o elige una en JPG.");
  }
  const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
  const ancho = Math.round(imagen.width * escala);
  const alto = Math.round(imagen.height * escala);
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const dibujo = lienzo.getContext("2d");
  if (!dibujo) throw new ErrorFoto("Este navegador no puede preparar la foto.");
  dibujo.drawImage(imagen, 0, 0, ancho, alto);
  imagen.close();

  let blob: Blob | null = null;
  for (const calidad of CALIDADES) {
    blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/jpeg", calidad));
    if (!blob) throw new ErrorFoto("No se pudo preparar la foto.");
    if (blob.size <= FOTO_MAXIMA_BYTES) break;
  }
  // Soltar el lienzo ya: en el teléfono la memoria es justa.
  lienzo.width = 0;
  lienzo.height = 0;
  if (!blob || blob.size > FOTO_MAXIMA_BYTES) {
    throw new ErrorFoto(
      `La foto pesa ${enMb(blob?.size ?? archivo.size)} MB y el máximo es ${enMb(FOTO_MAXIMA_BYTES)} MB. Tómala de nuevo.`
    );
  }
  const nombre = archivo.name.replace(/\.[^.]+$/, "") || "foto";
  return new File([blob], `${nombre}.jpg`, { type: "image/jpeg" });
}

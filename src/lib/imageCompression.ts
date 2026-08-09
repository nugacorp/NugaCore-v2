// ====================================================================
// Compresión de imágenes en el navegador.
//
// Vive aparte de `documentUpload.ts` a propósito: aquello es lógica pura y
// testeable en Node, y esto necesita canvas, `Image` y `URL.createObjectURL`.
// Se inyecta como `encodeImage`, así que los tests del flujo no lo tocan y este
// módulo sólo se ejecuta donde hay DOM.
//
// Por qué existe: en 4G rural una subida de 5 MB falla, y el bucket rechaza a
// partir de 10 MiB. Una foto de móvil a 1600 px con JPEG q0.8 baja de 3-5 MB a
// 200-400 KB, que sigue siendo de sobra para leer una INE.
// ====================================================================

import type { ImageEncoder, UploadableFile } from './documentUpload';

/** Lado mayor → escala, manteniendo proporción. Nunca amplía. */
export const scaleToFit = (
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } => {
  const longest = Math.max(width, height);
  if (longest <= maxDimension || longest === 0) return { width, height };
  const ratio = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
};

/** Reemplaza la extensión: el contenido pasa a ser JPEG, el nombre debe decirlo. */
export const withJpegExtension = (fileName: string): string =>
  `${fileName.replace(/\.[^./\\]+$/, '')}.jpg`;

const loadImage = (blob: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });

/**
 * Recodifica a JPEG con el lado mayor acotado. Si algo falla, lanza: quien
 * llama (`compressIfImage`) se queda con el original, porque comprimir es una
 * optimización y no puede impedir que se suba la INE.
 */
export const canvasImageEncoder: ImageEncoder = async (file, { maxDimension, quality }) => {
  const blob = file as unknown as Blob;
  const img = await loadImage(blob);
  const { width, height } = scaleToFit(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDimension);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible.');
  ctx.drawImage(img, 0, 0, width, height);

  const encoded = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
  if (!encoded) throw new Error('No se pudo recodificar la imagen.');

  return new File([encoded], withJpegExtension(file.name), {
    type: 'image/jpeg',
  }) as unknown as UploadableFile;
};

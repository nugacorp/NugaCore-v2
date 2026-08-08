import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Upload, WifiOff } from 'lucide-react';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  ASSIGNABLE_DOC_TYPES,
  DOC_TYPE_LABEL,
  DocumentUploadError,
  uploadClientDocument,
  type AssignableDocType,
  type DocumentTransport,
  type ObjectPutter,
  type UploadableFile,
} from '../lib/documentUpload';
import { canvasImageEncoder } from '../lib/imageCompression';

// ====================================================================
// Control de subida del expediente — compartido entre el CRM y la PWA técnico.
//
// Es un cascarón: toda la decisión vive en `src/lib/documentUpload.ts`, que se
// testea de verdad. Aquí sólo hay estado de UI y el `PUT` de los bytes.
//
// Lo que E3 parametriza SIN tocar este archivo:
//   - `transport`: el CRM inyecta `createAuthorizedApi`, la PWA un envoltorio
//     de `fetchWithRateLimitBackoff` para no perder su backoff de 429.
//   - `docTypes`: el CRM ofrece los cuatro, la PWA puede fijar sólo fotos.
//   - `idPrefix`: los ids del DOM no colisionan al montarse en dos sitios.
//   - `putObject` y `encodeImage`: existen para poder sustituirlos; por defecto
//     son `fetch` y el canvas.
// ====================================================================

/** El PUT va DIRECTO al bucket, no a nuestra API: ni auth ni backoff aplican. */
const defaultPutObject: ObjectPutter = async (uploadUrl, file) => {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: file as unknown as Blob,
    headers: { 'Content-Type': file.type },
  });
  if (!res.ok) throw new Error(`El almacenamiento rechazó el archivo (${res.status}).`);
};

/** `navigator.onLine` con sus dos eventos. Sin conexión no se encola nada. */
export const useOnlineStatus = (): boolean => {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
};

interface Props {
  clientId: string;
  transport: DocumentTransport;
  onUploaded: () => void | Promise<void>;
  docTypes?: readonly AssignableDocType[];
  defaultDocType?: AssignableDocType;
  idPrefix?: string;
  disabled?: boolean;
  putObject?: ObjectPutter;
}

export default function DocumentUploadControl({
  clientId,
  transport,
  onUploaded,
  docTypes = ASSIGNABLE_DOC_TYPES,
  defaultDocType,
  idPrefix = 'document-upload',
  disabled = false,
  putObject = defaultPutObject,
}: Props) {
  const online = useOnlineStatus();
  const [docType, setDocType] = useState<AssignableDocType>(defaultDocType ?? docTypes[0] ?? 'other');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const blocked = disabled || !online || uploading;

  const handleFile = useCallback(
    async (picked: File | undefined) => {
      if (!picked) return;
      setError(null);
      setNotice(null);
      setUploading(true);
      try {
        await uploadClientDocument({
          clientId,
          docType,
          file: picked as unknown as UploadableFile,
          transport,
          putObject,
          encodeImage: canvasImageEncoder,
          isOnline: online,
        });
        setNotice('Documento subido.');
        await onUploaded();
      } catch (err) {
        const message =
          err instanceof DocumentUploadError
            ? err.orphanLeft
              ? `${err.message} Quedó un archivo sin registrar en el almacenamiento.`
              : err.message
            : 'No se pudo subir el documento.';
        setError(message);
      } finally {
        setUploading(false);
        // Permite reintentar el MISMO archivo: sin esto el input no dispara
        // change de nuevo y el usuario cree que el botón dejó de funcionar.
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [clientId, docType, transport, putObject, online, onUploaded],
  );

  return (
    <div id={`${idPrefix}-control`} className="space-y-1.5">
      <div className="flex gap-2">
        <select
          id={`${idPrefix}-type`}
          aria-label="Tipo de documento"
          value={docType}
          disabled={blocked}
          onChange={(e) => setDocType(e.target.value as AssignableDocType)}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-white disabled:opacity-50"
        >
          {docTypes.map((t) => (
            <option key={t} value={t}>{DOC_TYPE_LABEL[t] ?? t}</option>
          ))}
        </select>
        <input
          ref={inputRef}
          id={`${idPrefix}-file`}
          type="file"
          className="hidden"
          accept={ALLOWED_DOCUMENT_MIME_TYPES.join(',')}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          id={`${idPrefix}-button`}
          disabled={blocked}
          onClick={() => inputRef.current?.click()}
          className="px-2 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 text-[10px] inline-flex items-center gap-1 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          <span>{uploading ? 'Subiendo…' : 'Subir'}</span>
        </button>
      </div>

      {!online && (
        // Nada se encola: que el técnico vea que no puede subir es mejor que
        // creer que subió y descubrirlo cuando ya se fue de casa del cliente.
        <p id={`${idPrefix}-offline`} className="flex items-center gap-1 text-[10px] text-amber-400">
          <WifiOff className="w-3 h-3" />
          Sin conexión: no puedes subir archivos ahora. No se guarda nada en cola.
        </p>
      )}
      {error && (
        <p id={`${idPrefix}-error`} className="flex items-start gap-1 text-[10px] text-rose-400">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {notice && !error && (
        <p id={`${idPrefix}-notice`} className="text-[10px] text-emerald-400">{notice}</p>
      )}
      <p className="text-[9px] text-slate-600">
        PDF o imagen (JPG, PNG, WebP), máx. 10 MB. Las fotos se comprimen antes de subir.
      </p>
    </div>
  );
}

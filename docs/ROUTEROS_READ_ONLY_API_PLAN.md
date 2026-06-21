# RouterOS Read-Only API Plan (FAST-1, Parte D)

> Plan de la **siguiente fase**: lectura read-only de RouterOS contra un CHR de
> laboratorio. **Documento de diseño**: NO se implementa conexión real en FAST-1.
>
> Estrictamente READ-ONLY: sin writes, sin worker live, sin commit mode, sin tocar
> routers reales. Fecha: 2026-06-21.

## 0. Alcance

Definir cómo NugaCore leerá información de un router RouterOS **solo para observar**,
empezando por un CHR de lab (ver `docs/CHR_LAB_PREP_RUNBOOK.md`). Ninguna operación de
esta fase modifica el router.

Prerrequisitos (gates) antes de implementar esta fase:

- [ ] CHR de lab preparado y con backup (runbook Parte C).
- [ ] Worker separado del proceso web (no se activa en FAST-1).
- [ ] `MIKROTIK_WORKER_LIVE` permanece `false` hasta validación en lab.
- [ ] `USE_DB_MIKROTIK` permanece `false`.

## 1. Comandos read-only objetivo

Solo lectura; cada uno mapea a un comando `print` de RouterOS:

| Lectura | Comando RouterOS | Uso en NugaCore |
|---|---|---|
| Identidad | `/system identity print` | Confirmar nombre/identidad del router |
| Recursos | `/system resource print` | CPU, RAM, uptime, versión RouterOS, board |
| Interfaces | `/interface print` | Estado/lista de interfaces (up/down) |
| Direcciones IP | `/ip address print` | IPs asignadas por interfaz |
| Rutas | `/ip route print` | Tabla de rutas (gateways, destinos) |

Sin `add`/`set`/`remove`/`enable`/`disable`. Solo `print`/`get`.

## 2. Allowlist estricta

La fase de implementación debe usar una **allowlist** de comandos read-only; cualquier
comando fuera de la lista se rechaza antes de enviarse. Reutilizar/extender la base
existente del worker (`READ_ONLY_COMMANDS` en `backend/domains/mikrotik/worker/types.ts`)
sin habilitar el modo live en esta fase.

Allowlist mínima de esta fase:

```
/system/identity/print
/system/resource/print
/interface/print
/ip/address/print
/ip/route/print
```

## 3. Conexión (fase de implementación, no ahora)

- Contra el **CHR de lab** únicamente (no routers reales).
- API-SSL (`8729`) preferido; `8728` solo como excepción documentada de lab.
- Credenciales cifradas, fuera del repo, por entorno.
- Timeouts y reintentos acotados; si el router no responde → "sin datos", nunca inventar.
- Worker separado del proceso web; en modo lectura (sin live global).

## 4. Sanitización de salida

- Toda salida que se persista, loguee o muestre debe pasar por
  `backend/common/security/sanitize-sensitive-data.ts`.
- No exponer secretos, claves, passwords ni scripts completos.
- No imprimir la salida cruda completa en logs; resumir.

## 5. Integración con observabilidad existente

La lectura alimenta el NOC read-only / telemetría ya existentes (4.11.2/4.11.3):
`/system resource` → CPU/RAM/uptime/versión; `/interface` → estado de interfaces.
Hoy esos datos vienen del store; esta fase los reemplazaría por lectura real **solo**
desde el CHR de lab, detrás del gate `MIKROTIK_WORKER_LIVE`.

## 6. Criterios de aceptación (de la fase futura)

- [ ] Las 5 lecturas devuelven datos del CHR de lab vía API.
- [ ] Ningún comando fuera de la allowlist se ejecuta (rechazo previo).
- [ ] Cero writes: no hay `add/set/remove/enable/disable`.
- [ ] Salida sanitizada; logs sin secretos ni dumps crudos.
- [ ] Degradación segura si el router no responde.
- [ ] Probado primero en CHR/lab; routers reales fuera de alcance.

## 7. Lo que esta fase NO hace

- ❌ No escribe nada en RouterOS.
- ❌ No activa worker live ni commit mode.
- ❌ No toca routers reales ni producción.
- ❌ No habilita `USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`.

## 8. Secuencia

```
CHR Lab Prep (Parte C)            ← documental, hecho
  ↓
RouterOS Read-Only en CHR (este plan)   ← siguiente fase, gated
  ↓
Dry-run de escrituras en CHR
  ↓
Escrituras controladas en CHR
  ↓
Router real no crítico (read-only → acción pequeña)
  ↓
Producción gradual
```

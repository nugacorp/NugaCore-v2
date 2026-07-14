# Router Onboarding Wizard — Fix de selección de plantilla (Fase 4.9.1)

## Auditoría de `src/components/RouterOnboardingWizard.tsx`

| Punto auditado | Estado |
|---|---|
| Estado del formulario | `useState<AdvancedOnboardingForm>(freshDefaultForm)` — única fuente de verdad |
| templateId default | `DEFAULT_ADVANCED_FORM.templateId = 'router_base_wireguard'` |
| Lista de plantillas | `ONBOARDING_TEMPLATES` (9 plantillas con `id` correctos) |
| Handler de selección | Paso 3: cada card llama a la mutación de `form.templateId` |
| Resumen Paso 5 | Lee `getTemplateLabel(form.templateId)` |
| `buildAdvancedEnrollmentPayload(form)` | Incluye `templateId: form.templateId` vía `buildEnrollmentPayload` |
| Reset accidental al avanzar de paso | Ninguno: las transiciones de paso (`stepTo`) no tocan `form.templateId` |
| Sin `useEffect` que reescriba templateId | Confirmado: el componente solo importa `useState`, no hay efectos |
| Valor hardcodeado a router_base_wireguard | Ninguno fuera del default explícito |

### Verificación de la cadena de datos (helpers puros, ya cubiertos por tests)

- `buildEnrollmentPayload(form)` → `templateId: form.templateId` (sin hardcode).
- `buildAdvancedEnrollmentPayload(form)` → propaga `templateId` desde `form`.
- `getTemplateLabel('pcc_5wan')` → `'Balanceador PCC — 5 WAN'`.

La cadena selección → resumen → payload es correcta a nivel de datos y está
verificada por tests unitarios que pasan. El resumen y el payload leen el mismo
`form.templateId`; no pueden divergir.

## Causa raíz

El riesgo concreto era que la mutación de la selección estuviera escrita inline
(`setF({ templateId: tpl.id })`) sin un punto único, tipado y testeable de
mutación, lo que dificultaba garantizar y verificar que la selección actualiza
exactamente `form.templateId`.

## Cambio realizado

1. **Mutación canónica**: nuevo helper puro `setTemplateSelection(form, templateId)`
   en `routerOnboardingView.ts`. El card del Paso 3 ahora muta vía
   `setForm((f) => setTemplateSelection(f, tpl.id))`. Única fuente de verdad:
   `form.templateId`. Sin estado `selectedTemplate` paralelo.

2. **Resumen** (Paso 5): lee `getTemplateLabel(form.templateId)` — sin default
   hardcodeado.

3. **Payload**: `buildAdvancedEnrollmentPayload(form)` incluye
   `templateId: form.templateId`. Solo cae a `router_base_wireguard` cuando
   `form.templateId` está vacío.

4. **Endurecimiento UI**: cada card de plantilla lleva `type="button"`
   (evita submit implícito si hubiera un `<form>` ancestro), `aria-pressed`,
   y `data-testid={`template-card-${tpl.id}`}` para verificación.

## Garantías

- **form.templateId se actualiza**: el único handler de click del card invoca
  `setTemplateSelection(f, tpl.id)`, testeado para los 9 templates.
- **El resumen usa form.templateId**: `getTemplateLabel(form.templateId)`,
  testeado (`pcc_5wan` → "Balanceador PCC — 5 WAN").
- **El payload manda pcc_5wan**: `buildAdvancedEnrollmentPayload(form).templateId
  === form.templateId`, testeado tras `setTemplateSelection`.

## Nota de despliegue

`npm run dev`/`start` sirve el bundle compilado en `dist/`. Tras este fix debe
ejecutarse un build fresco y desplegarse para que staging sirva el JS corregido
(un bundle cacheado/antiguo seguiría mostrando el comportamiento previo).

# NugaCore — Resumen Ejecutivo (EXECUTIVE_SUMMARY)

> Para: Dueño del proyecto (NugaCorp) · Fecha: 2026-07-07
> Documento no técnico. Detalle en los demás archivos de `docs/`.

---

## 1. Estado real del proyecto

NugaCore es una plataforma para administrar **toda** una empresa de internet (WISP/fibra) desde un solo lugar: clientes, facturación, cobranza, red, soporte, inventario, mapas y monitoreo.

**La verdad sin adornos:**

> **La aplicación se ve y se siente terminada** —10 módulos completos, pantallas profesionales, KPIs, mapas, consola MikroTik con asistente de IA—, **pero por dentro funciona con datos de demostración que viven en la memoria del servidor.** Al reiniciar el servidor, todo lo capturado se borra. **Todavía no es un sistema que pueda usar el negocio en el día a día.**

Dicho de otro modo: tenemos un **excelente prototipo funcional de alta fidelidad**. Falta convertirlo en un **producto de producción** conectándolo a una base de datos real, asegurando el acceso e integrando los equipos de red reales.

La buena noticia: el trabajo de diseño "invisible" pesado **ya está hecho** (estructura del backend, diseño de la base de datos, reglas de seguridad, contrato de datos). Lo que queda es, en su mayoría, "cablear" piezas que ya existen.

---

## 2. ¿Qué porcentaje está terminado?

| Dimensión | Avance | Comentario |
|-----------|:------:|------------|
| **Interfaz de usuario (frontend)** | ~90% | Completa y pulida; no requiere rediseño |
| **Persistencia real (datos que perduran)** | ~70–80% | 7/7 flags críticos en staging; `storeFallbackActive: false` con flags ON |
| **API / lógica de negocio** | ~80% | 40+ dominios; production gates dry-run→live |
| **Seguridad / acceso** | ~40% | Estructura buena, pero el control de acceso es burlable hoy |
| **Integración MikroTik (red real)** | ~25% | Worker commit gated; CHR read-only staging |
| **Pagos y facturación fiscal (CFDI) reales** | ~20% | Webhooks + reactivación gated; CFDI stub |
| **Listo para producción (deploy/operación)** | ~35% | Staging validado; gates `NUGACORE_LIVE_MODE` |

**Estimación global ponderada hacia "producción usable": ~60–70%.**
La percepción de "casi listo" viene de que **lo visible (la UI) sí está casi listo**; lo costoso que falta es lo que no se ve.

---

## 3. ¿Qué falta? (en lenguaje de negocio)

1. **Memoria permanente:** conectar una base de datos para que los datos no se pierdan. *(Lo más importante.)*
2. **Inicio de sesión seguro de verdad:** hoy, técnicamente, alguien podría entrar con permisos que no le corresponden. Hay que cerrar esa puerta.
3. **Conexión real con los routers MikroTik:** que suspender/reactivar a un cliente realmente corte/active su internet (hoy solo se simula).
4. **Cobros en línea y facturas fiscales (CFDI) reales:** integrar pasarela de pago y timbrado.
5. **Automatizaciones reales:** que las suspensiones por falta de pago y las alertas ocurran solas (hoy se disparan manualmente).
6. **Puesta en producción:** empaquetar, desplegar en el servidor (VPS con Coolify) y respaldos reales.

---

## 4. Riesgos principales

| Riesgo | Gravedad | Qué significa para el negocio |
|--------|:--------:|-------------------------------|
| Datos en memoria | 🔴 Crítico | Si el servidor se reinicia, se pierde todo lo capturado |
| Control de acceso burlable | 🔴 Crítico | Riesgo de que se acceda/modifique información sin permiso |
| Datos sensibles sin proteger | 🟠 Alto | Contraseñas y datos de clientes expuestos; riesgo legal/reputacional |
| Sin pruebas automáticas | 🟠 Alto | Al "cablear" la base de datos podríamos romper algo sin darnos cuenta |
| MikroTik simulado | 🟠 Alto | La parte de operación de red no es real todavía |
| Sin despliegue ni respaldos reales | 🟡 Medio | No hay forma robusta de operar ni recuperar ante un fallo |

> **Mitigación:** todos estos riesgos son conocidos y tienen plan. El orden de trabajo propuesto los ataca primero (seguridad y persistencia antes que nada).

---

## 5. Tiempo estimado

> Estimación de ingeniería para llevar NugaCore de "prototipo" a "producción usable". Supone **1 desarrollador full-stack senior** dedicado (ajustable con más gente en paralelo donde el trabajo lo permite).

| Etapa | Resultado para el negocio | Tiempo (1 dev) |
|-------|---------------------------|:--------------:|
| **Estabilización** (pruebas, CI, Docker) | Base segura para trabajar sin romper nada | 1–2 semanas |
| **Base de datos real + Clientes** | Los datos empiezan a perdurar | 2–3 semanas |
| **Inicio de sesión seguro** | Acceso confiable por roles | 1–2 semanas |
| **Migrar todos los módulos a la base de datos** | Sistema persistente completo | 4–6 semanas |
| **MikroTik real** | Cortes/reactivaciones reales | 3–4 semanas |
| **Automatizaciones + monitoreo real** | Operación desatendida | 2–3 semanas |
| **Pagos en línea + CFDI** | Cobranza moderna y fiscal | 3–5 semanas |
| **Endurecimiento + despliegue** | En el servidor, seguro y con respaldos | 2–3 semanas |

**Total estimado:** **~4.5 a 7 meses** con un desarrollador senior dedicado.
**MVP usable internamente** (módulos clave persistentes + login seguro, sin MikroTik real ni pagos en línea): **~2 a 3 meses**.

> Rango amplio porque MikroTik real y CFDI dependen de factores externos (hardware de laboratorio, proveedor de timbrado, pasarela de pago).

---

## 6. Costos estimados (orientativos)

> Cifras de referencia para planificación; varían según proveedores y país.

### Costos recurrentes (operación mensual)
| Concepto | Estimado mensual (USD) |
|----------|------------------------|
| VPS (servidor) | $20 – $80 |
| Base de datos (Supabase plan Pro) | $25 – $100 |
| Dominio + TLS | ~$1–2 (TLS gratis con Let's Encrypt) |
| IA (Gemini, copiloto) | $0 – $50 (según uso; tiene modo gratuito/fallback) |
| Pasarela de pago | % por transacción (≈2.9% + comisión) |
| Timbrado CFDI (PAC) | por timbre (centavos a pesos por factura) |
| **Subtotal infraestructura** | **~$50 – $250/mes** |

### Costos de desarrollo (una sola vez)
- Depende del modelo: desarrollador interno (salario) vs. contratista.
- Como referencia de esfuerzo: **~4.5–7 meses-persona senior** para producción completa; **~2–3 meses** para MVP.

> La infraestructura es **barata**; el costo dominante es el **tiempo de ingeniería**.

---

## 7. Prioridades (qué pedir primero)

1. 🥇 **Que los datos no se pierdan** (base de datos real) — habilita todo lo demás.
2. 🥈 **Acceso seguro** (login real por roles) — protege el negocio y a los clientes.
3. 🥉 **Migrar los módulos de dinero y red** (facturación, cobranza, clientes, red) a la base de datos.
4. **MikroTik real** — para que la operación de internet sea efectiva.
5. **Pagos en línea + CFDI** — para modernizar la cobranza.
6. **Automatización + despliegue final** — para operar con poco esfuerzo manual.

---

## 8. Recomendación de fondo

- **Conservar el frontend** tal cual: está muy bien y rehacerlo sería tirar dinero.
- **No migrar de tecnología (Next.js) ahora**: la prioridad es funcionalidad real, no cambiar de herramienta (detalle técnico en la conclusión de la auditoría).
- **Invertir el próximo trimestre en lo invisible**: base de datos, seguridad y persistencia. Es lo que convierte el prototipo en negocio.
- **Trabajar por módulos, con red de seguridad** (pruebas), para no romper lo que ya funciona.

> En resumen: **NugaCore tiene una base sólida y una cara muy profesional. Está a unos meses de ser un sistema real.** El siguiente paso lógico no es agregar más pantallas, sino darle "memoria" y "candado" a lo que ya existe.

---

### Documentos de soporte
- Contexto y alcance → [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)
- Arquitectura → [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
- Módulos → [MODULES_ANALYSIS.md](MODULES_ANALYSIS.md)
- Base de datos → [DATABASE_ANALYSIS.md](DATABASE_ANALYSIS.md)
- API → [API_ANALYSIS.md](API_ANALYSIS.md)
- Seguridad → [SECURITY_AUDIT.md](SECURITY_AUDIT.md)
- Deuda técnica → [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md)
- Backlog → [MASTER_BACKLOG.md](MASTER_BACKLOG.md)
- Estrategia → [DEVELOPMENT_STRATEGY.md](DEVELOPMENT_STRATEGY.md)

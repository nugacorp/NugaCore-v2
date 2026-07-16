import React, { useState } from 'react';
import {
  BookText,
  LayoutDashboard,
  Users,
  Wrench,
  CreditCard,
  Banknote,
  Ban,
  Network,
  Terminal,
  Wifi,
  BookOpen,
  Server,
  Box,
  HelpCircle,
  Info,
  ChevronDown,
} from 'lucide-react';

// ====================================================================
// Manual de Usuario — guía rápida 100% frontend (sin backend, sin APIs).
// Primera versión: secciones con pasos básicos para operar NugaCore. No
// describe funciones internas (WireGuard, Safe Mode, Command Queue) como
// módulos operativos normales.
// ====================================================================

type ManualSection = {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  summary: string;
  steps: string[];
};

const SECTIONS: ManualSection[] = [
  {
    id: 'dashboard',
    title: 'Inicio / Dashboard',
    icon: LayoutDashboard,
    summary: 'Vista general del estado operativo del WISP: clientes, cobranza, red y alertas.',
    steps: [
      'Abre "Inicio → Dashboard" para ver los indicadores clave (clientes activos, MRR, tickets, torres).',
      'La campana de notificaciones está en la BARRA SUPERIOR DERECHA. Ábrela para ver/confirmar alertas NOC.',
      'Usa "Actualizar" para refrescar los datos contra el servidor.',
    ],
  },
  {
    id: 'portal',
    title: 'Portal del Cliente (App aislada)',
    icon: Users,
    summary:
      'El Portal se abre como aplicación independiente, sin menús del WISP. Úsalo para que el abonado consulte saldo, facturas y reporte fallas.',
    steps: [
      'Comparte al abonado el enlace desde la ficha CRM: "Copiar enlace del portal".',
      'El enlace recomendado es: /?app=portal&client=<id>. Si solo viene client=<id>, el sistema fuerza el modo portal.',
      'En el portal el cliente solo ve su cuenta. No hay acceso a Red, Facturación interna ni Operaciones del WISP.',
    ],
  },
  {
    id: 'tech-pwa',
    title: 'App de Técnicos (PWA aislada)',
    icon: Wrench,
    summary:
      'Aplicación de campo para instalación y soporte. Se abre aislada del shell WISP y puede instalarse como PWA.',
    steps: [
      'Abre /?app=tech e inicia sesión con un usuario con rol de Técnico/Soporte.',
      'Desde aquí gestionas tareas de instalación/atención sin menús administrativos.',
      'Para compartirla, envía /?app=tech a tus técnicos; pueden “Instalar app” desde el navegador.',
    ],
  },
  {
    id: 'clientes',
    title: 'Clientes',
    icon: Users,
    summary: 'Alta y gestión de clientes y prospectos, con su plan asignado.',
    steps: [
      'Entra a "Clientes → Clientes".',
      'Usa el botón de nuevo cliente para registrar nombre, contacto y plan.',
      'Cambia el estado de un cliente (activo / suspendido / baja) desde su ficha.',
    ],
  },
  {
    id: 'acciones-rapidas-cliente',
    title: 'Acciones rápidas y Cliente 360',
    icon: Users,
    summary: 'Operación ágil del cliente desde la lista, sin cambiar de módulo.',
    steps: [
      'En la lista de clientes, usa la columna "Acciones" y el botón ⋮ para abrir el menú agrupado (Cliente, Servicio, Cobranza, Soporte, Red, Historial). Solo verás las acciones permitidas por tu rol.',
      'Elige "Ver perfil" para abrir el panel Cliente 360 con resumen (plan, IP, router, dirección, GPS), acciones rápidas e historial reciente.',
      '"Copiar IP" copia la IP al portapapeles; "Ver ubicación" abre Google Maps si el cliente tiene coordenadas.',
      'Registrar pago y Crear ticket guardan un registro local (mock) en el historial del cliente; aún no impactan facturación ni soporte reales.',
      'Suspender / Reactivar piden confirmación y se registran como SIMULACIÓN: no ejecutan cambios en el router. Generar factura y Cambiar plan muestran "pendiente de integración".',
      'Cambiar IP valida el formato y que no esté duplicada con otro cliente; la aplicación al router está pendiente de integración.',
    ],
  },
  {
    id: 'alta-cliente-wisp',
    title: 'Alta de Cliente WISP',
    icon: Wifi,
    summary: 'Flujo completo de alta con GPS, cobertura, IPAM y reserva de inventario.',
    steps: [
      'En "Clientes → Clientes", abre "Alta Nuevo Cliente" y selecciona Cliente Activo.',
      'Selecciona Router / Torre. Revisa clientes activos, capacidad libre y porcentaje utilizado; es un indicador informativo que no bloquea el alta.',
      'Pulsa "Obtener ubicación actual" para capturar GPS o edita latitud/longitud manualmente. El sistema valida los rangos permitidos.',
      'Pulsa "Calcular cobertura" para consultar distancia, azimut, cobertura estimada y estado GOOD / WARNING / POOR. La advertencia no bloquea el alta.',
      'En Reserva de equipo selecciona CPE, PoE o fuente, serie y MAC. La reserva queda en estado RESERVED sin descontar stock.',
      'En Asignación de Red selecciona el pool, escanea o captura una IP y confirma que esté disponible antes de crear el cliente.',
      '[Captura placeholder: capacidad del router y asignación IPAM]',
      '[Captura placeholder: GPS y resultado de cobertura]',
      '[Captura placeholder: reserva de inventario para instalación]',
    ],
  },
  {
    id: 'tickets',
    title: 'Tickets',
    icon: Wrench,
    summary: 'Soporte técnico y órdenes de trabajo de los clientes.',
    steps: [
      'Entra a "Clientes → Tickets".',
      'Crea un ticket asociándolo al cliente y describe la incidencia.',
      'Agrega mensajes de seguimiento y actualiza el estado de la orden de trabajo.',
    ],
  },
  {
    id: 'billing',
    title: 'Facturación y Planes',
    icon: CreditCard,
    summary: 'Catálogo de planes, emisión de facturas y registro de cobros.',
    steps: [
      'Entra a "Clientes → Facturación / Planes".',
      'Genera o edita facturas de un cliente.',
      'Registra el pago de una factura (total o parcial) y consulta el estado de cuenta.',
    ],
  },
  {
    id: 'payments',
    title: 'Pagos',
    icon: Banknote,
    summary: 'Portal de pagos y reactivación de servicio.',
    steps: [
      'Entra a "Clientes → Pagos".',
      'Consulta los pagos registrados por cliente.',
      'Usa el flujo de reactivación cuando un cliente regulariza su saldo.',
    ],
  },
  {
    id: 'suspension',
    title: 'Suspensiones',
    icon: Ban,
    summary: 'Cortes y reactivaciones por mora (motor lógico, sin tocar routers reales).',
    steps: [
      'Entra a "Clientes → Suspensiones".',
      'Revisa los clientes evaluables y las órdenes de corte/reactivación.',
      'Evalúa un cliente o todos para generar las órdenes correspondientes. Es un proceso lógico/simulado.',
    ],
  },
  {
    id: 'red-noc',
    title: 'Red / NOC',
    icon: Network,
    summary:
      'Monitoreo de red y planta FTTH. NOC es solo lectura; el mapa FTTH muestra NAPs/OLTs/ONUs y capacidad, y permite registrar tramos de fibra.',
    steps: [
      'Entra a "Red → NOC" para ver telemetría y alertas activas de la red (solo lectura, no opera cambios).',
      'En "Red → Mapa FTTH" consulta NAPs, ONUs y OLTs. El panel “Capacidad NAP / PON” muestra puertos totales, usados y libres.',
      'En el panel "Infraestructura de fibra" registra tramos (desde/hasta, hilos, NAP/PON). Es borrador local hasta activar la API/OLT.',
      'En "Red → Torres y Sitios" administra torres, OLT/ONU y NAPs.',
    ],
  },
  {
    id: 'inventario',
    title: 'Inventario',
    icon: Box,
    summary: 'Control de stock y movimientos de equipo del WISP.',
    steps: [
      'Entra a "Red → Inventario".',
      'Consulta existencias por almacén y el detalle de cada artículo.',
      'Registra entradas, salidas y transferencias de equipo.',
      'Las reservas creadas desde el alta WISP son internas/mock y no descuentan existencias hasta una fase posterior autorizada.',
    ],
  },
  {
    id: 'mikrotik',
    title: 'MikroTik / Routers',
    icon: Terminal,
    summary: 'Inventario de routers y panel operativo MikroTik (lectura y provisioning seguro).',
    steps: [
      'Entra a "Sistema → Routers" para ver el inventario, verificar online o eliminar equipos.',
      'El NOC (Red → NOC) es solo lectura: no borra routers; gestiona el inventario aquí.',
      'El panel avanzado MikroTik (si tu rol lo abre) trabaja en modo lectura/seguro.',
    ],
  },
  {
    id: 'router-enrollment',
    title: 'Alta de Router',
    icon: Wifi,
    summary: 'Onboarding guiado de un router nuevo. El acceso VPN se prepara automáticamente.',
    steps: [
      'Entra a "Sistema → Routers" y pulsa "Dar de alta".',
      'Completa el asistente con los datos del router y el tipo de conexión.',
      'El sistema genera el script de provisioning y prepara el acceso interno por VPN sin pasos manuales.',
    ],
  },
  {
    id: 'torres',
    title: 'Torres y Sitios',
    icon: Network,
    summary:
      'Gestión de torres y sitios WISP. Alta rápida con PIN en mapa y zona automática; lat/lng siguen editables para precisión.',
    steps: [
      'Entra a "Red → Torres y Sitios" y usa "Agregar torre".',
      'Coloca el PIN en el mapa para una ubicación rápida; puedes afinar con latitud/longitud.',
      'Si la zona no existe, se crea automáticamente con la información de la torre; luego agrega routers a esa zona.',
    ],
  },
  {
    id: 'templates-scripts',
    title: 'Plantillas y Scripts',
    icon: BookOpen,
    summary: 'Plantillas RouterOS y scripts/recursos reutilizables para configurar routers.',
    steps: [
      'Entra a "Sistema → Plantillas" para elegir o parametrizar una plantilla RouterOS.',
      'Los scripts avanzados viven en el workspace MikroTik (acceso por rol), no en el menú diario.',
      'Estas vistas generan configuración; no aplican cambios en routers reales por sí solas.',
    ],
  },
  {
    id: 'routeros-lab',
    title: 'Laboratorio MikroTik',
    icon: Server,
    summary: 'Laboratorio de solo lectura para inspeccionar un RouterOS sin ejecutar comandos.',
    steps: [
      'Si tu rol tiene acceso, abre el laboratorio MikroTik desde el workspace avanzado.',
      'Consulta identidad, sistema, interfaces, rutas y WireGuard del equipo de laboratorio.',
      'Es estrictamente de lectura: no ejecuta ni modifica nada en RouterOS.',
    ],
  },
  {
    id: 'faq',
    title: 'Preguntas frecuentes',
    icon: HelpCircle,
    summary: 'Dudas comunes sobre módulos visibles, infraestructura interna y seguridad.',
    steps: [
      '¿Portal y App Técnicos por qué no salen en el menú? Son apps aisladas: usa /?app=portal&client=<id> y /?app=tech.',
      '¿Dónde veo alertas? En la campana de la barra superior derecha (NOC).',
      '¿Dónde está WireGuard? Interno: se crea automáticamente al dar de alta un router.',
      '¿Por qué no veo Modo Seguro ni Cola Dry-Run? Son herramientas internas; no son operación diaria.',
      '¿Qué rol veo? El menú se filtra por permisos (RBAC).',
    ],
  },
];

export default function UserManualModule() {
  const [openId, setOpenId] = useState<string>(SECTIONS[0].id);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center">
            <BookText className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Manual de Usuario</h1>
            <p className="text-sm text-slate-400 mt-0.5">Guía rápida para operar NugaCore.</p>
          </div>
        </div>
      </header>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3.5 mb-6 flex items-start space-x-3">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed text-amber-200/90">
          Las funciones internas de seguridad como WireGuard, Safe Mode y Command Queue no están
          disponibles como módulos operativos normales. WireGuard se administra automáticamente al dar
          de alta un router; Safe Mode y la Cola de Comandos son herramientas internas para fases futuras.
        </p>
      </div>

      <div className="space-y-2.5">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const isOpen = openId === section.id;
          return (
            <div
              key={section.id}
              className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? '' : section.id)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-900/70 transition"
              >
                <span className="flex items-center space-x-3 min-w-0">
                  <Icon className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-100 truncate">{section.title}</span>
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-800/70">
                  <p className="text-xs text-slate-400 mb-3 leading-relaxed">{section.summary}</p>
                  <ol className="space-y-2">
                    {section.steps.map((step, idx) => (
                      <li key={idx} className="flex items-start space-x-2.5 text-sm text-slate-300">
                        <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-indigo-600/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-mono flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

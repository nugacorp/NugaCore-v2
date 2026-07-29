// ====================================================================
// Plan de comandos de ONU por familia de CLI.
//
// Traduce una acción del dominio (autorizar / dar de baja / suspender /
// reactivar / reiniciar una ONU) a la secuencia CLI de la marca, reusando la
// abstracción `cliFlavor` que ya usa el advisor de configuración.
//
// NO EJECUTA NADA. Devuelve el plan que se guarda en olt_actions.planned_commands
// para que un operador lo revise. Agregar una marca nueva = agregar un traductor
// aquí, sin tocar el resto del CRM.
//
// Las plantillas siguen el mismo criterio que script-generator.ts: son un punto
// de partida verificable contra el manual del equipo, no verdad absoluta.
// ====================================================================

import type { OltCliFlavor } from './types';

export const OLT_ACTION_TYPES = [
  'provision_onu',
  'deauthorize_onu',
  'suspend_onu',
  'restore_onu',
  'reboot_onu',
  'custom',
] as const;

export type OltActionType = (typeof OLT_ACTION_TYPES)[number];

export const isOltActionType = (value: unknown): value is OltActionType =>
  OLT_ACTION_TYPES.includes(String(value) as OltActionType);

/** Parámetros de una acción sobre una ONU concreta. */
export interface OnuActionPayload {
  /** Número de serie GPON/EPON (identificador real de la ONU). */
  serial?: string;
  /** Puerto PON en notación de la marca: '0/1/0' (Huawei) o '1/1/1' (ZTE). */
  ponPort?: string;
  /** Índice de la ONU dentro del puerto PON. */
  onuIndex?: number;
  vlan?: number;
  lineProfileId?: string | number;
  serviceProfileId?: string | number;
  /** Modelo de ONU; ZTE y C-Data lo exigen al autorizar. */
  onuType?: string;
  /** Etiqueta legible (nombre del cliente) para la descripción en la OLT. */
  description?: string;
  /** Comandos crudos, sólo para action_type 'custom'. */
  rawCommands?: string[];
}

export interface OltCommandPlan {
  flavor: OltCliFlavor;
  actionType: OltActionType;
  commands: string[];
  warnings: string[];
}

const REVIEW_WARNING =
  'Plan generado por plantilla: verificar contra el manual del equipo antes de habilitar ejecución.';

const sanitize = (value: string): string => value.replace(/["\n\r]/g, '').trim();

const label = (payload: OnuActionPayload): string =>
  sanitize(payload.description || 'cliente-nugacore').slice(0, 32);

/**
 * Huawei separa el puerto PON como frame/slot/port; `ont add` recibe el port y
 * el índice por separado, por eso se parte la última componente.
 */
const huaweiParts = (ponPort: string): { iface: string; port: string } => {
  const parts = ponPort.split('/');
  if (parts.length >= 3) {
    return { iface: `${parts[0]}/${parts[1]}`, port: parts[2] };
  }
  return { iface: ponPort, port: '0' };
};

type Builder = (payload: OnuActionPayload) => string[];

const huaweiBuilders: Record<OltActionType, Builder> = {
  provision_onu: (p) => {
    const { iface, port } = huaweiParts(p.ponPort ?? '0/1/0');
    return [
      'enable',
      'config',
      `interface gpon ${iface}`,
      ` ont add ${port} ${p.onuIndex} sn-auth "${sanitize(p.serial ?? '')}" omci` +
        ` ont-lineprofile-id ${p.lineProfileId ?? 10} ont-srvprofile-id ${p.serviceProfileId ?? 10}` +
        ` desc "${label(p)}"`,
      ` ont port native-vlan ${port} ${p.onuIndex} eth 1 vlan ${p.vlan} priority 0`,
      ' quit',
      `service-port vlan ${p.vlan} gpon ${iface}/${port} ont ${p.onuIndex} gemport 1` +
        ` multi-service user-vlan ${p.vlan} tag-transform translate`,
      'save',
    ];
  },
  deauthorize_onu: (p) => {
    const { iface, port } = huaweiParts(p.ponPort ?? '0/1/0');
    return ['enable', 'config', `interface gpon ${iface}`, ` ont delete ${port} ${p.onuIndex}`, ' quit', 'save'];
  },
  suspend_onu: (p) => {
    const { iface, port } = huaweiParts(p.ponPort ?? '0/1/0');
    return ['enable', 'config', `interface gpon ${iface}`, ` ont deactivate ${port} ${p.onuIndex}`, ' quit'];
  },
  restore_onu: (p) => {
    const { iface, port } = huaweiParts(p.ponPort ?? '0/1/0');
    return ['enable', 'config', `interface gpon ${iface}`, ` ont activate ${port} ${p.onuIndex}`, ' quit'];
  },
  reboot_onu: (p) => {
    const { iface, port } = huaweiParts(p.ponPort ?? '0/1/0');
    return ['enable', 'config', `interface gpon ${iface}`, ` ont reset ${port} ${p.onuIndex}`, ' quit'];
  },
  custom: (p) => p.rawCommands ?? [],
};

const zteBuilders: Record<OltActionType, Builder> = {
  provision_onu: (p) => [
    'configure terminal',
    `interface gpon-olt_${p.ponPort}`,
    ` onu ${p.onuIndex} type ${p.onuType ?? 'ALL'} sn ${sanitize(p.serial ?? '')}`,
    ' exit',
    `interface gpon-onu_${p.ponPort}:${p.onuIndex}`,
    ` name ${label(p)}`,
    ` tcont 1 profile ${p.lineProfileId ?? 'dba-nuga'}`,
    ' gemport 1 tcont 1',
    ` service-port 1 vport 1 user-vlan ${p.vlan} vlan ${p.vlan}`,
    ' exit',
    'write',
  ],
  deauthorize_onu: (p) => [
    'configure terminal',
    `interface gpon-olt_${p.ponPort}`,
    ` no onu ${p.onuIndex}`,
    ' exit',
    'write',
  ],
  suspend_onu: (p) => [
    'configure terminal',
    `interface gpon-onu_${p.ponPort}:${p.onuIndex}`,
    ' shutdown',
    ' exit',
  ],
  restore_onu: (p) => [
    'configure terminal',
    `interface gpon-onu_${p.ponPort}:${p.onuIndex}`,
    ' no shutdown',
    ' exit',
  ],
  reboot_onu: (p) => [
    'configure terminal',
    `pon-onu-mng gpon-onu_${p.ponPort}:${p.onuIndex}`,
    ' reboot',
    ' exit',
  ],
  custom: (p) => p.rawCommands ?? [],
};

const vsolBdcomBuilders: Record<OltActionType, Builder> = {
  provision_onu: (p) => [
    'enable',
    'config',
    `interface epon ${p.ponPort}`,
    ` epon bind-onu sn ${sanitize(p.serial ?? '')} ${p.onuIndex}`,
    ' exit',
    `interface epon ${p.ponPort}:${p.onuIndex}`,
    ` description ${label(p)}`,
    ` epon onu port 1 ctc vlan mode tag ${p.vlan}`,
    ' exit',
    'write',
  ],
  deauthorize_onu: (p) => [
    'enable',
    'config',
    `interface epon ${p.ponPort}`,
    ` no epon bind-onu ${p.onuIndex}`,
    ' exit',
    'write',
  ],
  suspend_onu: (p) => ['enable', 'config', `interface epon ${p.ponPort}:${p.onuIndex}`, ' shutdown', ' exit'],
  restore_onu: (p) => ['enable', 'config', `interface epon ${p.ponPort}:${p.onuIndex}`, ' no shutdown', ' exit'],
  reboot_onu: (p) => ['enable', 'config', `epon reboot-onu ${p.ponPort}:${p.onuIndex}`],
  custom: (p) => p.rawCommands ?? [],
};

const cdataBuilders: Record<OltActionType, Builder> = {
  provision_onu: (p) => [
    'enable',
    'configure terminal',
    `interface gpon ${p.ponPort}`,
    ` onu ${p.onuIndex} type ${p.onuType ?? 'auto'} sn ${sanitize(p.serial ?? '')}`,
    ` onu ${p.onuIndex} description ${label(p)}`,
    ` onu ${p.onuIndex} tcont 1 profile ${p.lineProfileId ?? 'dba-nuga'}`,
    ` onu ${p.onuIndex} service 1 gemport 1 vlan ${p.vlan}`,
    ' exit',
    'save',
  ],
  deauthorize_onu: (p) => [
    'enable',
    'configure terminal',
    `interface gpon ${p.ponPort}`,
    ` no onu ${p.onuIndex}`,
    ' exit',
    'save',
  ],
  suspend_onu: (p) => [
    'enable',
    'configure terminal',
    `interface gpon ${p.ponPort}`,
    ` onu ${p.onuIndex} deactivate`,
    ' exit',
  ],
  restore_onu: (p) => [
    'enable',
    'configure terminal',
    `interface gpon ${p.ponPort}`,
    ` onu ${p.onuIndex} activate`,
    ' exit',
  ],
  reboot_onu: (p) => [
    'enable',
    'configure terminal',
    `interface gpon ${p.ponPort}`,
    ` onu ${p.onuIndex} reboot`,
    ' exit',
  ],
  custom: (p) => p.rawCommands ?? [],
};

// Fiberhome AN5516 usa una CLI de navegación por menús (cd / set), no IOS-like.
const fiberhomeBuilders: Record<OltActionType, Builder> = {
  provision_onu: (p) => [
    'enable',
    'cd onu',
    `set whitelist phy_addr address ${sanitize(p.serial ?? '')} password null action add` +
      ` slot ${p.ponPort} pon ${p.onuIndex} onuid ${p.onuIndex} type ${p.onuType ?? 'AN5506-04'}`,
    'cd ..',
    'cd service',
    `add service_port ${p.onuIndex} vlan ${p.vlan} onuid ${p.onuIndex} desc ${label(p)}`,
    'cd ..',
    'save',
  ],
  deauthorize_onu: (p) => [
    'enable',
    'cd onu',
    `set whitelist phy_addr address ${sanitize(p.serial ?? '')} action delete`,
    'cd ..',
    'save',
  ],
  suspend_onu: (p) => ['enable', 'cd onu', `set onu status slot ${p.ponPort} pon ${p.onuIndex} disable`, 'cd ..'],
  restore_onu: (p) => ['enable', 'cd onu', `set onu status slot ${p.ponPort} pon ${p.onuIndex} enable`, 'cd ..'],
  reboot_onu: (p) => ['enable', 'cd onu', `reboot onu slot ${p.ponPort} pon ${p.onuIndex}`, 'cd ..'],
  custom: (p) => p.rawCommands ?? [],
};

const genericBuilders: Record<OltActionType, Builder> = {
  provision_onu: (p) => [
    '! Familia de CLI no catalogada — traducir a la sintaxis del equipo:',
    `! 1) Autorizar ONU serie ${p.serial ?? '<SERIE>'} en PON ${p.ponPort ?? '<PON>'} índice ${p.onuIndex ?? '<N>'}`,
    `! 2) Asignar perfil de línea ${p.lineProfileId ?? '<LINE-PROFILE>'} y servicio ${p.serviceProfileId ?? '<SRV-PROFILE>'}`,
    `! 3) Mapear VLAN ${p.vlan ?? '<VLAN>'} al puerto de usuario`,
    `! 4) Descripción: ${label(p)}`,
    '! 5) Guardar configuración',
  ],
  deauthorize_onu: (p) => [`! Eliminar ONU ${p.serial ?? '<SERIE>'} de PON ${p.ponPort ?? '<PON>'}`],
  suspend_onu: (p) => [`! Desactivar ONU índice ${p.onuIndex ?? '<N>'} en PON ${p.ponPort ?? '<PON>'}`],
  restore_onu: (p) => [`! Activar ONU índice ${p.onuIndex ?? '<N>'} en PON ${p.ponPort ?? '<PON>'}`],
  reboot_onu: (p) => [`! Reiniciar ONU índice ${p.onuIndex ?? '<N>'} en PON ${p.ponPort ?? '<PON>'}`],
  custom: (p) => p.rawCommands ?? [],
};

const BUILDERS: Record<OltCliFlavor, Record<OltActionType, Builder>> = {
  huawei: huaweiBuilders,
  zte: zteBuilders,
  'vsol-bdcom': vsolBdcomBuilders,
  cdata: cdataBuilders,
  fiberhome: fiberhomeBuilders,
  generic: genericBuilders,
};

/** Campos que cada acción necesita para producir un plan aplicable. */
const REQUIRED_FIELDS: Record<OltActionType, Array<keyof OnuActionPayload>> = {
  provision_onu: ['serial', 'ponPort', 'onuIndex', 'vlan'],
  deauthorize_onu: ['ponPort', 'onuIndex'],
  suspend_onu: ['ponPort', 'onuIndex'],
  restore_onu: ['ponPort', 'onuIndex'],
  reboot_onu: ['ponPort', 'onuIndex'],
  custom: [],
};

export const missingPayloadFields = (
  actionType: OltActionType,
  payload: OnuActionPayload,
): string[] =>
  REQUIRED_FIELDS[actionType].filter((field) => {
    const value = payload[field];
    return value === undefined || value === null || value === '';
  });

/**
 * Construye el plan de comandos. Nunca lanza: si faltan datos devuelve el plan
 * con la advertencia correspondiente, para que la acción quede registrada y
 * auditable aunque no sea aplicable todavía.
 */
export const buildOltCommandPlan = (
  flavor: OltCliFlavor,
  actionType: OltActionType,
  payload: OnuActionPayload = {},
): OltCommandPlan => {
  const builders = BUILDERS[flavor] ?? genericBuilders;
  const missing = missingPayloadFields(actionType, payload);
  const warnings = [REVIEW_WARNING];

  if (missing.length > 0) {
    warnings.push(`Faltan datos para un plan aplicable: ${missing.join(', ')}.`);
  }
  if (actionType === 'custom' && (payload.rawCommands ?? []).length === 0) {
    warnings.push('Acción custom sin comandos: el plan queda vacío.');
  }
  if (flavor === 'generic') {
    warnings.push('Marca sin traductor específico: el plan es una guía, no comandos ejecutables.');
  }

  return {
    flavor,
    actionType,
    commands: builders[actionType](payload),
    warnings,
  };
};

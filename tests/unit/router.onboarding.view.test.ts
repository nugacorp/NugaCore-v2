import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_TEMPLATES,
  ROUTER_TYPE_OPTIONS,
  MODEL_OPTIONS,
  DEFAULT_FORM,
  getTemplateV7Warning,
  buildNotesFromForm,
  buildEnrollmentPayload,
  OnboardingForm,
} from '../../src/lib/routerOnboardingView';

// ── Constantes ────────────────────────────────────────────────────────

describe('ONBOARDING_TEMPLATES — catálogo', () => {
  it('contiene 10 plantillas', () => {
    expect(ONBOARDING_TEMPLATES).toHaveLength(10);
  });

  it('cada plantilla tiene id, label, description y routerosVersion', () => {
    for (const tpl of ONBOARDING_TEMPLATES) {
      expect(tpl.id,          `plantilla sin id`).toBeTruthy();
      expect(tpl.label,       `${tpl.id} sin label`).toBeTruthy();
      expect(tpl.description, `${tpl.id} sin description`).toBeTruthy();
      expect(['6', '7', 'any']).toContain(tpl.routerosVersion);
    }
  });

  it('mapea correctamente los IDs de plantillas conocidas', () => {
    const ids = ONBOARDING_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('router_base_wireguard');
    expect(ids).toContain('tower_wisp');
    expect(ids).toContain('pcc_2wan');
    expect(ids).toContain('pcc_3wan');
    expect(ids).toContain('pcc_4wan');
    expect(ids).toContain('pcc_5wan');
    expect(ids).toContain('pppoe_server');
    expect(ids).toContain('noc_ready');
  });

  it('nugacore_factory_onboarding es la primera plantilla (default)', () => {
    expect(ONBOARDING_TEMPLATES[0].id).toBe('nugacore_factory_onboarding');
  });
});

describe('ROUTER_TYPE_OPTIONS', () => {
  it('tiene 5 tipos de router', () => {
    expect(ROUTER_TYPE_OPTIONS).toHaveLength(5);
  });

  it('incluye core, tower, distribution, client_router, lab', () => {
    const values = ROUTER_TYPE_OPTIONS.map((o) => o.value);
    expect(values).toContain('core');
    expect(values).toContain('tower');
    expect(values).toContain('distribution');
    expect(values).toContain('client_router');
    expect(values).toContain('lab');
  });

  it('cada opción tiene value y label', () => {
    for (const opt of ROUTER_TYPE_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });
});

describe('MODEL_OPTIONS', () => {
  it('incluye RB5009, CCR, CHR, hEX, hAP, Otro', () => {
    const values = MODEL_OPTIONS.map((o) => o.value);
    expect(values).toContain('RB5009');
    expect(values).toContain('CCR');
    expect(values).toContain('CHR');
    expect(values).toContain('hEX');
    expect(values).toContain('hAP');
    expect(values).toContain('Otro');
  });
});

describe('DEFAULT_FORM', () => {
  it('routerName está vacío por defecto', () => {
    expect(DEFAULT_FORM.routerName).toBe('');
  });

  it('routerosVersion es v7 por defecto', () => {
    expect(DEFAULT_FORM.routerosVersion).toBe('7');
  });

  it('templateId es nugacore_factory_onboarding por defecto', () => {
    expect(DEFAULT_FORM.templateId).toBe('nugacore_factory_onboarding');
  });

  it('lanCidr tiene valor por defecto correcto', () => {
    expect(DEFAULT_FORM.lanCidr).toBe('192.168.88.0/24');
  });

  it('lanGateway tiene valor por defecto correcto', () => {
    expect(DEFAULT_FORM.lanGateway).toBe('192.168.88.1');
  });

  it('wanInterface es ether1 por defecto', () => {
    expect(DEFAULT_FORM.wanInterface).toBe('ether1');
  });

  it('lanBridgeName es bridgeLAN por defecto', () => {
    expect(DEFAULT_FORM.lanBridgeName).toBe('bridgeLAN');
  });
});

// ── getTemplateV7Warning ───────────────────────────────────────────────

describe('getTemplateV7Warning', () => {
  it('devuelve null para plantilla "any" con v6', () => {
    expect(getTemplateV7Warning('pcc_2wan', '6')).toBeNull();
  });

  it('devuelve null para plantilla v7-only con v7', () => {
    expect(getTemplateV7Warning('router_base_wireguard', '7')).toBeNull();
  });

  it('devuelve advertencia para plantilla v7-only con v6', () => {
    const warning = getTemplateV7Warning('router_base_wireguard', '6');
    expect(warning).not.toBeNull();
    expect(warning).toContain('v7');
  });

  it('devuelve advertencia para tower_wisp con v6', () => {
    const warning = getTemplateV7Warning('tower_wisp', '6');
    expect(warning).not.toBeNull();
    expect(warning).toContain('Torre WISP');
  });

  it('devuelve null para templateId desconocido', () => {
    expect(getTemplateV7Warning('nonexistent_template', '6')).toBeNull();
  });

  it('plantillas PCC son compatibles con v6 (no warning)', () => {
    for (const id of ['pcc_2wan', 'pcc_3wan', 'pcc_4wan', 'pcc_5wan']) {
      expect(getTemplateV7Warning(id, '6'), `${id} debería ser compatible con v6`).toBeNull();
    }
  });
});

// ── buildNotesFromForm ────────────────────────────────────────────────

describe('buildNotesFromForm', () => {
  const base: OnboardingForm = { ...DEFAULT_FORM, routerName: 'Test', routerType: 'tower', model: 'RB5009', templateId: 'router_base_wireguard', siteName: '', notes: '' };

  it('incluye el tipo de router entre corchetes', () => {
    expect(buildNotesFromForm(base)).toContain('[tower]');
  });

  it('incluye el modelo si no es "Otro"', () => {
    expect(buildNotesFromForm(base)).toContain('Modelo: RB5009');
  });

  it('omite modelo si es "Otro"', () => {
    const form = { ...base, model: 'Otro' as const };
    expect(buildNotesFromForm(form)).not.toContain('Modelo:');
  });

  it('incluye el templateId', () => {
    expect(buildNotesFromForm(base)).toContain('Plantilla: router_base_wireguard');
  });

  it('incluye el sitio si está definido', () => {
    const form = { ...base, siteName: 'Torre Norte' };
    expect(buildNotesFromForm(form)).toContain('Sitio: Torre Norte');
  });

  it('omite el sitio si está vacío', () => {
    expect(buildNotesFromForm(base)).not.toContain('Sitio:');
  });

  it('incluye las notas del usuario si están definidas', () => {
    const form = { ...base, notes: 'Reemplaza router viejo' };
    expect(buildNotesFromForm(form)).toContain('Reemplaza router viejo');
  });
});

// ── buildEnrollmentPayload ────────────────────────────────────────────

describe('buildEnrollmentPayload', () => {
  const base: OnboardingForm = { ...DEFAULT_FORM, routerName: 'TorreNorte' };

  it('incluye routerName limpio', () => {
    const payload = buildEnrollmentPayload({ ...base, routerName: '  TorreNorte  ' });
    expect(payload.routerName).toBe('TorreNorte');
  });

  it('incluye routerosVersion', () => {
    expect(buildEnrollmentPayload(base).routerosVersion).toBe('7');
  });

  it('incluye templateId', () => {
    expect(buildEnrollmentPayload(base).templateId).toBe('nugacore_factory_onboarding');
  });

  it('incluye routerType', () => {
    expect(buildEnrollmentPayload(base).routerType).toBe('tower');
  });

  it('incluye lanCidr y lanGateway', () => {
    const p = buildEnrollmentPayload(base);
    expect(p.lanCidr).toBe('192.168.88.0/24');
    expect(p.lanGateway).toBe('192.168.88.1');
  });

  it('incluye wanInterface', () => {
    expect(buildEnrollmentPayload(base).wanInterface).toBe('ether1');
  });

  it('NO incluye wgServerId (usa DEFAULT)', () => {
    expect(buildEnrollmentPayload(base)).not.toHaveProperty('wgServerId');
  });

  it('devuelve undefined para campos LAN vacíos', () => {
    const form = { ...base, lanCidr: '', lanGateway: '' };
    const p = buildEnrollmentPayload(form);
    expect(p.lanCidr).toBeUndefined();
    expect(p.lanGateway).toBeUndefined();
  });

  it('notas codifican metadatos del wizard', () => {
    const p = buildEnrollmentPayload(base);
    expect(typeof p.notes).toBe('string');
    expect(p.notes as string).toContain('[tower]');
    expect(p.notes as string).toContain('Plantilla:');
  });
});

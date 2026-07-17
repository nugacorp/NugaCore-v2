import { randomUUID } from 'node:crypto';
import { BadRequestError } from '../../common/errors';
import { logger } from '../../common/logger';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import {
  resolveAuthRedirectUrl,
  sendSignupConfirmationEmail,
} from '../auth/auth-email';
import { getNetworkService } from '../network/service';
import { getTenancyService } from '../tenancy/service';
import {
  StoreWispOnboardingRepository,
  SupabaseWispOnboardingRepository,
  type WispOnboardingRepository,
} from './repository';
import type {
  OnboardingStep,
  RegisterWispInput,
  RegisterWispResult,
  WispOnboardingState,
} from './types';

const STEPS_ORDER: OnboardingStep[] = ['company', 'zone', 'billing', 'router', 'done'];

const markStep = (state: WispOnboardingState, step: OnboardingStep): OnboardingStep[] => {
  const set = new Set(state.completedSteps);
  set.add(step);
  return STEPS_ORDER.filter((s) => set.has(s));
};

const nextStep = (completed: OnboardingStep[]): OnboardingStep => {
  for (const step of STEPS_ORDER) {
    if (step === 'done') continue;
    if (!completed.includes(step)) return step;
  }
  return 'done';
};

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export class WispOnboardingService {
  constructor(private readonly repo: WispOnboardingRepository) {}

  /**
   * El registro ya captura companyName/city/phone: marca el paso `company` como hecho
   * y avanza a `zone` (también repara filas antiguas que lo dejaron en `company`).
   */
  private async ensureCompanyCaptured(state: WispOnboardingState): Promise<WispOnboardingState> {
    if (state.status === 'completed') return state;
    if (!state.companyName?.trim()) return state;
    if (state.completedSteps.includes('company') && state.currentStep !== 'company') {
      return state;
    }
    const completedSteps = markStep(state, 'company');
    const currentStep = state.currentStep === 'company'
      ? nextStep(completedSteps)
      : state.currentStep;
    return this.repo.upsert({
      ...state,
      completedSteps,
      currentStep,
      updatedAt: new Date().toISOString(),
    });
  }

  async getStatus(tenantId: string): Promise<WispOnboardingState | null> {
    const state = await this.repo.get(tenantId);
    if (!state) return null;
    return this.ensureCompanyCaptured(state);
  }

  async isOnboardingRequired(tenantId: string): Promise<boolean> {
    if (!tenantId) return false;
    // tenant-default (legacy single-wisp) no fuerza wizard
    if (tenantId === 'tenant-default') return false;

    // Fuente de verdad: fila wisp_onboarding (no depender solo de tenants.*).
    const state = await this.repo.get(tenantId);
    if (state) return state.status !== 'completed';

    // Sin fila: mirar tenants.onboarding_status; si es in_progress o desconocido → required.
    if (isSupabaseAdminConfigured && supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from('tenants')
        .select('onboarding_status')
        .eq('id', tenantId)
        .maybeSingle();
      const status = String((data as { onboarding_status?: string } | null)?.onboarding_status || '');
      if (status === 'completed') return false;
      if (status === 'in_progress') return true;
    }
    // Tenant nuevo sin fila aún → exigir onboarding
    return true;
  }

  async register(input: RegisterWispInput): Promise<RegisterWispResult> {
    const companyName = String(input.companyName || '').trim();
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const fullName = String(input.fullName || '').trim();
    const phone = input.phone ? String(input.phone).trim() : undefined;
    const city = input.city ? String(input.city).trim() : undefined;
    const slug = slugify(input.slug || companyName);

    if (!companyName || !email || !password || !fullName || !slug) {
      throw new BadRequestError(
        'Campos requeridos: companyName, slug, email, password, fullName',
        'MISSING_FIELD',
      );
    }
    if (password.length < 8) {
      throw new BadRequestError('La contraseña debe tener al menos 8 caracteres', 'WEAK_PASSWORD');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestError('Email inválido', 'INVALID_EMAIL');
    }

    const tenancy = getTenancyService();
    const existingSlug = (await tenancy.listTenants()).find((t) => t.slug === slug);
    if (existingSlug) {
      throw new BadRequestError('Ese identificador de WISP ya está en uso', 'SLUG_TAKEN');
    }

    let userId: string = randomUUID();
    let createdAuthUserId: string | undefined;
    let note: string | undefined;
    let emailConfirmationRequired = false;
    let confirmationEmailSent = false;
    const emailRedirectTo = resolveAuthRedirectUrl(input.emailRedirectTo, '/auth/callback');

    try {
      if (isSupabaseAdminConfigured && supabaseAdmin) {
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          // Requiere el toggle "Confirm email" en Supabase Auth + correo SMTP/plantilla.
          email_confirm: false,
          user_metadata: { full_name: fullName, phone: phone || null },
          app_metadata: {},
        });
        if (error || !created.user) {
          const msg = error?.message || 'No se pudo crear el usuario';
          const code = /already|exists|registered/i.test(msg) ? 'EMAIL_EXISTS' : 'USER_CREATE_FAILED';
          throw new BadRequestError(msg, code);
        }
        userId = created.user.id;
        createdAuthUserId = userId;
        emailConfirmationRequired = true;

        await supabaseAdmin.from('users_profile').upsert({
          id: userId,
          email,
          full_name: fullName,
          phone: phone || null,
        }, { onConflict: 'id' });

        const { data: roleRow } = await supabaseAdmin
          .from('roles')
          .select('id')
          .eq('name', 'Administrador')
          .maybeSingle();
        if (roleRow?.id) {
          await supabaseAdmin.from('user_roles').upsert({
            user_id: userId,
            role_id: roleRow.id,
          }, { onConflict: 'user_id,role_id' });
        }
      } else {
        note = 'Usuario creado en modo store (sin Supabase Auth). Configura Supabase para login real.';
        logger.warn('WISP register sin Supabase Auth — solo store/tenancy');
      }

      const tenant = await tenancy.createTenant({
        name: companyName,
        slug,
        status: 'active',
        ownerUserId: userId,
      });

      if (isSupabaseAdminConfigured && supabaseAdmin) {
        const { data: tenantRow, error: tenantCheckErr } = await supabaseAdmin
          .from('tenants')
          .select('id')
          .eq('id', tenant.id)
          .maybeSingle();
        if (tenantCheckErr || !tenantRow) {
          throw new BadRequestError(
            'El tenant no quedó persistido en la base de datos. Revisa USE_DB_TENANCY / Supabase.',
            'TENANT_NOT_PERSISTED',
          );
        }

        const { error: statusErr } = await supabaseAdmin
          .from('tenants')
          .update({ onboarding_status: 'in_progress' })
          .eq('id', tenant.id);
        if (statusErr) {
          throw new BadRequestError(
            `Tenant creado pero onboarding_status falló: ${statusErr.message}`,
            'ONBOARDING_STATUS_FAILED',
          );
        }

        await supabaseAdmin.auth.admin.updateUserById(userId, {
          app_metadata: { tenant_id: tenant.id },
        });
      }

      // Nombre/ciudad/teléfono ya vienen del registro → no repetir paso "company".
      const completedSteps: OnboardingStep[] = ['company'];
      const onboarding = await this.repo.upsert({
        tenantId: tenant.id,
        status: 'in_progress',
        currentStep: 'zone',
        companyName,
        contactEmail: email,
        contactPhone: phone,
        city,
        completedSteps,
        updatedAt: new Date().toISOString(),
      });

      // Correo solo después de persistir tenant + onboarding (evita confirmación huérfana
      // si el registro fallaba con 500 tras createUser, como en el bug de FK).
      if (isSupabaseAdminConfigured && supabaseAdmin && emailConfirmationRequired) {
        const sent = await sendSignupConfirmationEmail(email, emailRedirectTo);
        confirmationEmailSent = sent.sent;
        if (!sent.sent) {
          note = 'Cuenta creada, pero no se pudo enviar el correo de confirmación. Usa «Reenviar confirmación» en el login.';
        }
      }

      return {
        tenantId: tenant.id,
        userId,
        email,
        slug: tenant.slug,
        onboarding,
        emailConfirmationRequired,
        confirmationEmailSent,
        note,
      };
    } catch (err) {
      // Evitar usuario Auth huérfano si falla tenant/onboarding (permite reintentar el mismo correo).
      if (createdAuthUserId && isSupabaseAdminConfigured && supabaseAdmin) {
        const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
        if (delErr) {
          logger.warn('WISP register: no se pudo borrar usuario Auth tras fallo', {
            userId: createdAuthUserId,
            message: delErr.message,
          });
        } else {
          logger.info('WISP register: usuario Auth revertido tras fallo', {
            userId: createdAuthUserId,
          });
        }
      }
      throw err;
    }
  }

  async saveCompany(
    tenantId: string,
    payload: { companyName: string; contactPhone?: string; city?: string },
  ): Promise<WispOnboardingState> {
    const prev = (await this.repo.get(tenantId)) || {
      tenantId,
      status: 'in_progress' as const,
      currentStep: 'company' as const,
      completedSteps: [] as OnboardingStep[],
      updatedAt: new Date().toISOString(),
    };
    const companyName = String(payload.companyName || '').trim();
    if (!companyName) throw new BadRequestError('companyName requerido', 'MISSING_FIELD');
    const completedSteps = markStep(prev, 'company');
    return this.repo.upsert({
      ...prev,
      companyName,
      contactPhone: payload.contactPhone ? String(payload.contactPhone).trim() : prev.contactPhone,
      city: payload.city ? String(payload.city).trim() : prev.city,
      completedSteps,
      currentStep: nextStep(completedSteps),
      status: 'in_progress',
    });
  }

  async saveZone(
    tenantId: string,
    payload: { zoneName: string; lat?: number; lng?: number },
  ): Promise<WispOnboardingState> {
    const prev = await this.repo.get(tenantId);
    if (!prev) throw new BadRequestError('Onboarding no iniciado', 'ONBOARDING_MISSING');
    const zoneName = String(payload.zoneName || '').trim();
    if (!zoneName) throw new BadRequestError('zoneName requerido', 'MISSING_FIELD');

    const network = getNetworkService();
    const towerId = `t-${tenantId.slice(0, 8)}-${Date.now().toString(36)}`;
    // Nombre único global (constraint towers.name UNIQUE) + legible para el WISP
    const towerName = `${zoneName} · ${tenantId.replace(/^tenant-/, '').slice(0, 10)}`;
    const { store } = await import('../../state/store');
    const tower = {
      id: towerId,
      name: towerName,
      status: 'online' as const,
      lat: Number.isFinite(Number(payload.lat)) ? Number(payload.lat) : 19.4326,
      lng: Number.isFinite(Number(payload.lng)) ? Number(payload.lng) : -99.1332,
      height: 30,
      coverageRadiusKm: 5,
      ip: '0.0.0.0',
      cpu: 0,
      ram: 0,
      tempCelsius: 0,
      pingMs: 0,
      uptime: '—',
      ports: [],
      equipment: [],
      tenantId,
    };
    if (!store.TOWERS.some((t) => t.id === towerId)) {
      store.TOWERS.push(tower);
    }
    await network.upsertTowerOnboarding(towerId, { zoneName }, tenantId);

    if (isSupabaseAdminConfigured && supabaseAdmin) {
      await supabaseAdmin.from('towers').upsert({
        id: towerId,
        name: towerName,
        status: 'online',
        lat: tower.lat,
        lng: tower.lng,
        height: 30,
        coverage_radius_km: 5,
        ip: '0.0.0.0',
        equipment: [],
        photos: [],
        tenant_id: tenantId,
      }, { onConflict: 'id' });
    }

    const completedSteps = markStep(prev, 'zone');
    return this.repo.upsert({
      ...prev,
      zoneName,
      zoneTowerId: towerId,
      completedSteps,
      currentStep: nextStep(completedSteps),
    });
  }

  async saveBilling(
    tenantId: string,
    payload: { billingCycleDay: number; billingCycleTime?: string },
  ): Promise<WispOnboardingState> {
    const prev = await this.repo.get(tenantId);
    if (!prev) throw new BadRequestError('Onboarding no iniciado', 'ONBOARDING_MISSING');
    const day = Number(payload.billingCycleDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new BadRequestError('billingCycleDay debe ser 1–31', 'INVALID_FIELD');
    }
    const time = payload.billingCycleTime
      ? String(payload.billingCycleTime).trim()
      : '08:00';

    if (prev.zoneTowerId) {
      await getNetworkService().upsertTowerOnboarding(prev.zoneTowerId, {
        zoneName: prev.zoneName,
        billingCycleDay: day,
        billingCycleTime: time,
      }, tenantId);
    }

    const completedSteps = markStep(prev, 'billing');
    return this.repo.upsert({
      ...prev,
      billingCycleDay: day,
      billingCycleTime: time,
      completedSteps,
      currentStep: nextStep(completedSteps),
    });
  }

  async saveRouter(
    tenantId: string,
    payload: { routerName: string; routerId?: string },
  ): Promise<WispOnboardingState> {
    const prev = await this.repo.get(tenantId);
    if (!prev) throw new BadRequestError('Onboarding no iniciado', 'ONBOARDING_MISSING');
    const routerName = String(payload.routerName || '').trim();
    if (!routerName) throw new BadRequestError('routerName requerido', 'MISSING_FIELD');
    const routerId = payload.routerId
      ? String(payload.routerId).trim()
      : `rtr-${tenantId.slice(0, 8)}-${Date.now().toString(36)}`;

    if (prev.zoneTowerId) {
      await getNetworkService().upsertTowerOnboarding(prev.zoneTowerId, {
        zoneName: prev.zoneName,
        billingCycleDay: prev.billingCycleDay,
        billingCycleTime: prev.billingCycleTime,
        routerId,
        routerName,
      }, tenantId);
    }

    const completedSteps = markStep(prev, 'router');
    return this.repo.upsert({
      ...prev,
      firstRouterId: routerId,
      firstRouterName: routerName,
      completedSteps,
      currentStep: nextStep(completedSteps),
    });
  }

  async complete(tenantId: string): Promise<WispOnboardingState> {
    const prev = await this.repo.get(tenantId);
    if (!prev) throw new BadRequestError('Onboarding no iniciado', 'ONBOARDING_MISSING');
    const required: OnboardingStep[] = ['company', 'zone', 'billing', 'router'];
    const missing = required.filter((s) => !prev.completedSteps.includes(s));
    if (missing.length > 0) {
      throw new BadRequestError(
        `Completa los pasos: ${missing.join(', ')}`,
        'ONBOARDING_INCOMPLETE',
      );
    }

    const completedSteps = markStep(prev, 'done');
    const done = await this.repo.upsert({
      ...prev,
      status: 'completed',
      currentStep: 'done',
      completedSteps,
      completedAt: new Date().toISOString(),
    });

    if (isSupabaseAdminConfigured && supabaseAdmin) {
      await supabaseAdmin
        .from('tenants')
        .update({ onboarding_status: 'completed' })
        .eq('id', tenantId);
    }

    return done;
  }
}

let singleton: WispOnboardingService | null = null;
let storeRepo: StoreWispOnboardingRepository | null = null;

const build = (): WispOnboardingService => {
  if (isSupabaseAdminConfigured && supabaseAdmin) {
    logger.info('WISP onboarding: persistencia = Supabase');
    return new WispOnboardingService(new SupabaseWispOnboardingRepository(supabaseAdmin));
  }
  if (!storeRepo) storeRepo = new StoreWispOnboardingRepository();
  logger.info('WISP onboarding: persistencia = store');
  return new WispOnboardingService(storeRepo);
};

export const getWispOnboardingService = (): WispOnboardingService => {
  if (!singleton) singleton = build();
  return singleton;
};

export const resetWispOnboardingService = (): void => {
  singleton = null;
  storeRepo?.reset();
  storeRepo = null;
};

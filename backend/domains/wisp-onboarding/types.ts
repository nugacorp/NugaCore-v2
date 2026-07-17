export type OnboardingStep = 'company' | 'zone' | 'billing' | 'router' | 'done';
export type OnboardingStatus = 'in_progress' | 'completed';

export interface WispOnboardingState {
  tenantId: string;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  companyName?: string;
  contactEmail?: string;
  contactPhone?: string;
  city?: string;
  zoneName?: string;
  zoneTowerId?: string;
  billingCycleDay?: number;
  billingCycleTime?: string;
  firstRouterId?: string;
  firstRouterName?: string;
  completedSteps: OnboardingStep[];
  completedAt?: string;
  updatedAt: string;
}

export interface RegisterWispInput {
  companyName: string;
  slug: string;
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  city?: string;
  /** Redirect tras confirmar correo (mismo origen que APP_URL). */
  emailRedirectTo?: string;
}

export interface RegisterWispResult {
  tenantId: string;
  userId: string;
  email: string;
  slug: string;
  onboarding: WispOnboardingState;
  /** true cuando el alta usó Supabase Auth sin auto-confirmar el correo. */
  emailConfirmationRequired: boolean;
  /** true si Supabase aceptó encolar el correo de confirmación. */
  confirmationEmailSent: boolean;
  /** Solo en modos sin Supabase Auth real (dev/store). */
  note?: string;
}

export interface WispOnboardingRow {
  tenant_id: string;
  status: string;
  current_step: string;
  company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  zone_name: string | null;
  zone_tower_id: string | null;
  billing_cycle_day: number | null;
  billing_cycle_time: string | null;
  first_router_id: string | null;
  first_router_name: string | null;
  completed_steps: unknown;
  completed_at: string | null;
  updated_at: string | null;
}

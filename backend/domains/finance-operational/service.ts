import { isDomainOnDb } from '../../config/feature-flags';
import { BadRequestError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { getBillingService } from '../billing/service';

export type ExpenseCategory = 'payroll' | 'rent' | 'utilities' | 'equipment' | 'marketing' | 'maintenance' | 'other';

export interface OperationalExpense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amountCents: number;
  currency: string;
  expenseDate: string;
  vendor?: string;
  createdBy?: string;
  createdAt: string;
}

const memory: OperationalExpense[] = [];
const uid = () => `exp-${Date.now()}`;
const today = () => new Date().toISOString().substring(0, 10);

export class FinanceOperationalService {
  private useDb = isDomainOnDb('finance') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase admin client not configured');
    return supabaseAdmin;
  }

  listExpenses(filters?: { category?: string; from?: string; to?: string }) {
    if (this.useDb) {
      return this.admin.from('operational_expenses').select('*').then(({ data, error }) => {
        if (error) throw error;
        let rows = (data ?? []).map((row) => ({
          id: String(row.id),
          category: row.category as ExpenseCategory,
          description: String(row.description),
          amountCents: Number(row.amount_cents),
          currency: String(row.currency ?? 'MXN'),
          expenseDate: String(row.expense_date),
          vendor: row.vendor ? String(row.vendor) : undefined,
          createdBy: row.created_by ? String(row.created_by) : undefined,
          createdAt: String(row.created_at),
        }));
        if (filters?.category) rows = rows.filter((e) => e.category === filters.category);
        if (filters?.from) rows = rows.filter((e) => e.expenseDate >= filters.from!);
        if (filters?.to) rows = rows.filter((e) => e.expenseDate <= filters.to!);
        return rows;
      });
    }
    return Promise.resolve(memory.filter((e) => {
      const matchCat = !filters?.category || e.category === filters.category;
      const matchFrom = !filters?.from || e.expenseDate >= filters.from;
      const matchTo = !filters?.to || e.expenseDate <= filters.to;
      return matchCat && matchFrom && matchTo;
    }));
  }

  async createExpense(body: Record<string, unknown>, createdBy?: string) {
    const description = String(body.description || '').trim();
    const amountCents = Math.round(Number(body.amountCents ?? (Number(body.amount ?? 0) * 100)));
    if (!description || amountCents <= 0) {
      throw new BadRequestError('Invalid expense: description and positive amount required', 'MISSING_FIELD');
    }
    const expense: OperationalExpense = {
      id: uid(),
      category: (String(body.category || 'other') as ExpenseCategory),
      description,
      amountCents,
      currency: String(body.currency || 'MXN'),
      expenseDate: body.expenseDate ? String(body.expenseDate) : today(),
      vendor: body.vendor ? String(body.vendor) : undefined,
      createdBy,
      createdAt: new Date().toISOString(),
    };
    memory.unshift(expense);
    if (this.useDb) {
      await this.admin.from('operational_expenses').insert({
        id: expense.id,
        category: expense.category,
        description: expense.description,
        amount_cents: expense.amountCents,
        currency: expense.currency,
        expense_date: expense.expenseDate,
        vendor: expense.vendor ?? null,
        created_by: expense.createdBy ?? null,
      });
    }
    return expense;
  }

  async getOperationalPnl(periodFrom?: string, periodTo?: string) {
    const from = periodFrom ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
    const to = periodTo ?? today();
    const expenses = await this.listExpenses({ from, to });
    const totalExpensesCents = expenses.reduce((s, e) => s + e.amountCents, 0);
    let revenueCents: number;
    try {
      const billing = getBillingService();
      const summary = await billing.getAccountSummary();
      revenueCents = Math.round(summary.totalCollected * 100);
    } catch {
      revenueCents = 0;
    }
    const grossMarginCents = revenueCents - totalExpensesCents;
    return {
      period: { from, to },
      revenueCents,
      expensesCents: totalExpensesCents,
      grossMarginCents,
      marginPercent: revenueCents > 0 ? Math.round((grossMarginCents / revenueCents) * 10000) / 100 : 0,
      expenseBreakdown: expenses.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] ?? 0) + e.amountCents;
        return acc;
      }, {}),
      cfdiNote: 'CFDI/timbrado real pendiente de integración PAC — ver ROADMAP Fase 4.9.',
    };
  }
}

let cached: FinanceOperationalService | null = null;
export const getFinanceOperationalService = () => {
  if (!cached) cached = new FinanceOperationalService();
  return cached;
};

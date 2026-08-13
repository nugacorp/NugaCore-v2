import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const envExample = readFileSync('.env.production.example', 'utf8');

describe('production env example', () => {
  it('uses webhook secret names expected by payment providers', () => {
    expect(envExample).toContain('WEBHOOK_SECRET_MERCADO_PAGO=__SECRET__');
    expect(envExample).toContain('WEBHOOK_SECRET_OPENPAY=__SECRET__');
    expect(envExample).not.toMatch(/^WEBHOOK_SECRET_MERCADOPAGO=/m);
  });

  it('documents the production strict readiness flags', () => {
    for (const line of [
      'NODE_ENV=production',
      'PUBLIC_DEPLOYMENT=true',
      'AUTH_TRUST_HEADERS=false',
      'USE_DB_PLANS=true',
      'USE_DB_BILLING=true',
      'USE_DB_PAYMENTS=true',
      'USE_DB_INVENTORY=true',
      'USE_DB_SUPPORT=true',
      'USE_DB_SUSPENSION=true',
      'CORS_ALLOWED_ORIGINS=https://tu-dominio.com',
    ]) {
      expect(envExample).toContain(line);
    }
  });

  it('documents OpenPay sandbox fallback variables without requiring real keys', () => {
    expect(envExample).toContain('OPENPAY_MERCHANT_ID=__SECRET__');
    expect(envExample).toContain('OPENPAY_PRIVATE_KEY=__SECRET__');
    expect(envExample).toContain('OPENPAY_SANDBOX=true');
  });
});

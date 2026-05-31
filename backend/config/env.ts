import dotenv from 'dotenv';

dotenv.config();

const asNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: asNumber(process.env.PORT, 3000),
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  AUTH_TRUST_HEADERS: (process.env.AUTH_TRUST_HEADERS || 'false').toLowerCase() === 'true',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  DATABASE_URL: process.env.DATABASE_URL || '',
  MIKROTIK_CREDENTIALS_KEY: process.env.MIKROTIK_CREDENTIALS_KEY || '',
} as const;

export const isProduction = env.NODE_ENV === 'production';

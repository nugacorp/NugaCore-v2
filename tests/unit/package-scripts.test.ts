import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};

describe('package readiness scripts', () => {
  it('exposes explicit strict production readiness commands', () => {
    expect(pkg.scripts?.['validate-production-readiness:strict']).toBe(
      'node -r dotenv/config --input-type=module -e "process.env.PRODUCTION_READINESS_STRICT=\'true\'; await import(\'./scripts/validate-production-readiness.mjs\')"',
    );
    expect(pkg.scripts?.['validate-restore-checklist:strict']).toBe(
      'node -r dotenv/config --input-type=module -e "process.env.PRODUCTION_RESTORE_STRICT=\'true\'; const { runValidateRestoreChecklistCli } = await import(\'./scripts/validate-restore-checklist.mjs\'); process.exit(runValidateRestoreChecklistCli())"',
    );
  });
});

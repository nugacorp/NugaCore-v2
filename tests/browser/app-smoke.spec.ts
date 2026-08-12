import { expect, test } from '@playwright/test';

test('loads the app shell with a supported dev session', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem('nugacore_user_profile', JSON.stringify({
      id: 'pw-superadmin',
      email: 'playwright@nugacore.local',
      full_name: 'Playwright Super Admin',
      role: 'Super Admin',
      permissions: [],
    }));
  });

  await page.goto('/');

  await expect(page.locator('body')).toContainText(/NugaCore|Dashboard|Clientes|CRM/i);
  await expect(page.locator('body')).not.toContainText(/Unauthorized|No active auth context/i);
  expect(pageErrors).toEqual([]);
});

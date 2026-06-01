import { Express } from 'express';
import authRoutes from './domains/auth/routes';
import healthRoutes from './domains/health/routes';
import automationsRoutes from './domains/automations/routes';
import billingRoutes from './domains/billing/routes';
import customersRoutes from './domains/customers/routes';
import dashboardRoutes from './domains/dashboard/routes';
import gisRoutes from './domains/gis/routes';
import inventoryRoutes from './domains/inventory/routes';
import mikrotikRoutes from './domains/mikrotik/routes';
import networkRoutes from './domains/network/routes';
import plansRoutes from './domains/plans/routes';
import reportsRoutes from './domains/reports/routes';
import securityRoutes from './domains/security/routes';
import suspensionRoutes from './domains/suspension/routes';
import ticketsRoutes from './domains/tickets/routes';

export function registerRoutes(app: Express): void {
  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(customersRoutes);
  app.use(plansRoutes);
  app.use(billingRoutes);
  app.use(reportsRoutes);
  app.use(automationsRoutes);
  app.use(securityRoutes);
  app.use(suspensionRoutes);
  app.use(networkRoutes);
  app.use(mikrotikRoutes);
  app.use(ticketsRoutes);
  app.use(inventoryRoutes);
  app.use(gisRoutes);
  app.use(dashboardRoutes);
}

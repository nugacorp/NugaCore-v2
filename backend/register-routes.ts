import { Express } from 'express';
import authRoutes from './domains/auth/routes';
import billingRoutes from './domains/billing/routes';
import customersRoutes from './domains/customers/routes';
import dashboardRoutes from './domains/dashboard/routes';
import gisRoutes from './domains/gis/routes';
import inventoryRoutes from './domains/inventory/routes';
import mikrotikRoutes from './domains/mikrotik/routes';
import networkRoutes from './domains/network/routes';
import plansRoutes from './domains/plans/routes';
import suspensionRoutes from './domains/suspension/routes';
import ticketsRoutes from './domains/tickets/routes';

export function registerRoutes(app: Express): void {
  app.use(authRoutes);
  app.use(customersRoutes);
  app.use(plansRoutes);
  app.use(billingRoutes);
  app.use(suspensionRoutes);
  app.use(networkRoutes);
  app.use(mikrotikRoutes);
  app.use(ticketsRoutes);
  app.use(inventoryRoutes);
  app.use(gisRoutes);
  app.use(dashboardRoutes);
}

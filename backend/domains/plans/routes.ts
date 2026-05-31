import { Router } from 'express';
import { Plan } from '../../../src/types';
import { store } from '../../../backend/state/store';
import { requireRoles } from '../../common/rbac';

const router = Router();

const asBusinessType = (value: unknown): 'Residencial' | 'Empresarial' | 'Dedicado' => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'empresarial') return 'Empresarial';
  if (normalized === 'dedicado') return 'Dedicado';
  return 'Residencial';
};

router.get('/api/plans', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const businessType = String(req.query.businessType || '').trim().toLowerCase();

  const rows = store.PLANS.map((plan) => {
    const metadata = store.getPlanMetadata(plan.id);
    return {
      ...plan,
      isActive: metadata.isActive,
      businessType: metadata.businessType,
    };
  });

  const filtered = rows.filter((plan) => {
    const matchesQ = !q || plan.name.toLowerCase().includes(q) || plan.id.toLowerCase().includes(q);
    const matchesStatus = !status || (status === 'active' ? plan.isActive : !plan.isActive);
    const matchesBusinessType = !businessType || plan.businessType.toLowerCase() === businessType;
    return matchesQ && matchesStatus && matchesBusinessType;
  });

  res.json(filtered);
});

router.get('/api/plans/:id', (_req, res) => {
  const plan = store.PLANS.find((p) => p.id === _req.params.id);
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  const metadata = store.getPlanMetadata(plan.id);
  res.json({
    ...plan,
    isActive: metadata.isActive,
    businessType: metadata.businessType,
  });
});

router.post('/api/plans', requireRoles(['super admin', 'administrador']), (req, res) => {
  const { name, speedMbpsDown, speedMbpsUp, price, type, businessType, isActive } = req.body;

  if (!name || speedMbpsDown === undefined || speedMbpsUp === undefined || price === undefined || !type) {
    return res.status(400).json({ error: 'Missing required fields: name, speedMbpsDown, speedMbpsUp, price, type' });
  }

  const duplicate = store.PLANS.some((plan) => plan.name.toLowerCase() === String(name).toLowerCase());
  if (duplicate) {
    return res.status(409).json({ error: 'Plan name already exists' });
  }

  const newPlan: Plan = {
    id: store.getUniquePlanId(),
    name: String(name),
    speedMbpsDown: Number(speedMbpsDown),
    speedMbpsUp: Number(speedMbpsUp),
    price: Number(price),
    type,
  };

  store.PLANS.push(newPlan);
  store.PLAN_METADATA.push({
    planId: newPlan.id,
    businessType: asBusinessType(businessType),
    isActive: isActive === undefined ? true : Boolean(isActive),
  });

  res.status(201).json({
    ...newPlan,
    businessType: asBusinessType(businessType),
    isActive: isActive === undefined ? true : Boolean(isActive),
  });
});

router.put('/api/plans/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const index = store.PLANS.findIndex((p) => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  const target = store.PLANS[index];
  const { name, speedMbpsDown, speedMbpsUp, price, type, businessType, isActive } = req.body;
  store.PLANS[index] = {
    ...target,
    ...(name !== undefined ? { name: String(name) } : {}),
    ...(speedMbpsDown !== undefined ? { speedMbpsDown: Number(speedMbpsDown) } : {}),
    ...(speedMbpsUp !== undefined ? { speedMbpsUp: Number(speedMbpsUp) } : {}),
    ...(price !== undefined ? { price: Number(price) } : {}),
    ...(type !== undefined ? { type } : {}),
  };

  const metadata = store.getPlanMetadata(req.params.id);
  metadata.businessType = businessType !== undefined ? asBusinessType(businessType) : metadata.businessType;
  metadata.isActive = isActive !== undefined ? Boolean(isActive) : metadata.isActive;

  res.json({
    ...store.PLANS[index],
    businessType: metadata.businessType,
    isActive: metadata.isActive,
  });
});

router.delete('/api/plans/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const inUse = store.CLIENTS.some((client) => client.planId === req.params.id);
  if (inUse) {
    return res.status(409).json({ error: 'Plan is in use by at least one client' });
  }

  const previousLength = store.PLANS.length;
  store.PLANS = store.PLANS.filter((p) => p.id !== req.params.id);
  store.PLAN_METADATA = store.PLAN_METADATA.filter((m) => m.planId !== req.params.id);

  if (store.PLANS.length === previousLength) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  res.status(204).send();
});

export default router;

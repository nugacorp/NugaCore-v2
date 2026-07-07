import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { requireRoles } from '../../common/rbac';
import { listRegisteredJobs, runAllJobs, runJob } from '../../jobs/runner';

const router = Router();

router.get('/api/jobs', requireRoles(['super admin', 'administrador']), asyncHandler(async (_req, res) => {
  res.json({ jobs: listRegisteredJobs() });
}));

router.post('/api/jobs/run', requireRoles(['super admin']), asyncHandler(async (req, res) => {
  const name = req.body?.job ? String(req.body.job) : '';
  const results = name ? [await runJob(name)] : await runAllJobs();
  res.json({ results });
}));

export default router;

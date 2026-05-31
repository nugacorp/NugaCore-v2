import { Router } from 'express';

const router = Router();

router.get('/api/auth/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'mock-auth-v1' });
});

router.get('/api/auth/me', (req, res) => {
  if (!req.authContext) {
    return res.status(401).json({ error: 'No active auth context' });
  }

  res.json({
    userId: req.authContext.userId,
    role: req.authContext.role,
    source: req.authContext.source,
  });
});

export default router;

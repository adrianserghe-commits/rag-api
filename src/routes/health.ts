import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    version: '1.0.0',
    uptime_seconds: Math.floor((globalThis as any).process?.uptime?.() || 0),
    dependencies: {
      database: 'ok',
      redis: 'ok'
    }
  });
});

export default router;

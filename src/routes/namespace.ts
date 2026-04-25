import { Router, Request, Response } from 'express';
import { requireHeaders } from '../middleware/headers';
import { db } from '../database';

const router = Router();

router.delete('/:namespace_id/sources/:source_id', requireHeaders(['Authorization', 'X-Tenant-ID']), async (req: Request, res: Response) => {
  try {
    const tenantId = (req.headers['x-tenant-id'] as string) || '';
    const { namespace_id, source_id } = req.params;
    
    await db.deleteSource(tenantId, namespace_id, source_id);
    res.status(204).send();
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to delete source', request_id: req.headers['x-request-id'] || 'unknown' } });
  }
});

router.delete('/:namespace_id', requireHeaders(['Authorization', 'X-Tenant-ID']), async (req: Request, res: Response) => {
  try {
    const tenantId = (req.headers['x-tenant-id'] as string) || '';
    const { namespace_id } = req.params;
    
    // In a real system, this might enqueue an async deletion job. 
    // Here we just delete it directly or mock the async response.
    await db.deleteNamespace(tenantId, namespace_id);
    
    res.status(202).json({
      job_id: `j_del_${Date.now()}`,
      status: "queued",
      sla: "24h"
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to delete namespace', request_id: req.headers['x-request-id'] || 'unknown' } });
  }
});

router.get('/:namespace_id/stats', requireHeaders(['Authorization', 'X-Tenant-ID']), async (req: Request, res: Response) => {
  try {
    const tenantId = (req.headers['x-tenant-id'] as string) || '';
    const { namespace_id } = req.params;

    // Mock stats for now
    res.status(200).json({
      namespace_id,
      chunk_count: 100,
      source_count: 5,
      total_tokens_indexed: 50000,
      last_ingested_at: new Date().toISOString(),
      embedding_model: process.env.LLM_MODEL || "google/gemini-2.0-flash-001",
      embedding_dim: 1536
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to get stats', request_id: req.headers['x-request-id'] } });
  }
});

export default router;

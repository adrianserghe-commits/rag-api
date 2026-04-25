import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { requireHeaders } from '../middleware/headers';
import { db } from '../database';
import { ingestQueue } from '../queue/ingestQueue';

import crypto from 'crypto';

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', requireHeaders(['Authorization', 'X-Request-ID', 'X-Tenant-ID', 'Idempotency-Key']), upload.single('file'), async (req: Request, res: Response) => {
  try {
    const tenantId = (req.headers['x-tenant-id'] as string) || '';
    const idempotencyKey = (req.headers['idempotency-key'] as string) || '';
    
    let payload = req.body;
    const requestWithFile = req as any;
    if (requestWithFile.file) {
      payload = req.body.payload ? JSON.parse(req.body.payload) : req.body;
    }

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    // Check idempotency
    const existingJob = await db.getJobByIdempotencyKey(tenantId, idempotencyKey);
    if (existingJob) {
      if (existingJob.payload_hash !== payloadHash) {
        return res.status(409).json({
          error: {
            code: 'duplicate_job',
            message: 'Idempotency-Key already exists with a different payload',
            request_id: req.headers['x-request-id'] || 'unknown'
          }
        });
      }
      return res.status(202).json({
        job_id: existingJob.job_id,
        status: existingJob.status,
        progress: {
          stage: existingJob.progress_stage,
          percent: existingJob.progress_percent,
          chunks_created: existingJob.progress_chunks_created
        },
        submitted_at: existingJob.submitted_at
      });
    }

    const { namespace_id, source_id, source_type, url } = payload;

    if (!namespace_id || !source_id || !source_type) {
      return res.status(400).json({
        error: { code: 'invalid_request', message: 'Missing required fields', request_id: req.headers['x-request-id'] }
      });
    }

    if (!['url', 'file'].includes(source_type)) {
      return res.status(422).json({
        error: { code: 'validation_error', message: 'source_type must be "url" or "file"', request_id: req.headers['x-request-id'] }
      });
    }

    if (source_type === 'url' && !url) {
      return res.status(422).json({
        error: { code: 'validation_error', message: 'url is required when source_type is "url"', request_id: req.headers['x-request-id'] }
      });
    }
    const jobId = `j_${uuidv4().replace(/-/g, '').substring(0, 8)}`;

    const newJob = await db.createIngestJob({
      job_id: jobId,
      tenant_id: tenantId,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      namespace_id,
      source_id,
      status: 'queued',
      progress_stage: 'queued',
      progress_percent: 0,
      progress_chunks_created: 0
    });

    await ingestQueue.add('ingest', {
      tenant_id: tenantId,
      job_id: jobId,
      namespace_id,
      source_id,
      source_type,
      url,
      file_path: req.file?.path
    });

    res.status(202).json({
      job_id: newJob.job_id,
      namespace_id: newJob.namespace_id,
      source_id: newJob.source_id,
      status: newJob.status,
      progress: {
        stage: newJob.progress_stage,
        percent: newJob.progress_percent,
        chunks_created: newJob.progress_chunks_created
      },
      submitted_at: newJob.submitted_at
    });
  } catch (error: any) {
    if (error.code === '23505') { // Postgres unique constraint violation
      return res.status(409).json({ error: { code: 'duplicate_job', message: 'Conflict', request_id: req.headers['x-request-id'] } });
    }
    console.error(error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to enqueue ingestion', request_id: req.headers['x-request-id'] } });
  }
});

router.get('/:job_id', requireHeaders(['X-Tenant-ID']), async (req: Request, res: Response) => {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const jobId = req.params.job_id;

    const { data: job, error } = await db.supabase
      .from('ingest_jobs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('job_id', jobId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: { code: 'not_found', message: 'Job not found', request_id: req.headers['x-request-id'] } });
      }
      throw error;
    }

    const response: any = {
      job_id: job.job_id,
      namespace_id: job.namespace_id,
      source_id: job.source_id,
      status: job.status,
      progress: {
        stage: job.progress_stage,
        percent: job.progress_percent,
        chunks_created: job.progress_chunks_created
      },
      submitted_at: job.submitted_at,
      completed_at: job.completed_at,
      estimated_completion_at: job.estimated_completion_at
    };

    if (job.status === 'failed' && job.error_code) {
      response.error = {
        code: job.error_code,
        message: job.error_message,
        retryable: job.error_retryable
      };
    }

    if (job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled') {
      res.setHeader('Retry-After', '5');
    }

    res.status(200).json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to retrieve job status', request_id: req.headers['x-request-id'] } });
  }
});

export default router;

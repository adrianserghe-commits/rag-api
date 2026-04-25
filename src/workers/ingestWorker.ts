import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { db } from '../database';

const connection = new Redis((globalThis as any).process?.env?.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

async function updateProgress(jobId: string, tenantId: string, stage: string, percent: number, chunksCreated: number = 0) {
  await db.supabase
    .from('ingest_jobs')
    .update({
      progress_stage: stage,
      progress_percent: percent,
      progress_chunks_created: chunksCreated,
      ...(stage === 'done' ? { status: 'done', completed_at: new Date().toISOString() } : { status: stage })
    })
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId);
}

const worker = new Worker('ingest-jobs', async (job: Job<any>) => {
  const { tenant_id, job_id, namespace_id, source_id, source_type, url, file_path } = job.data;
  let chunksCreated = 0;

  try {
    // 1. fetching
    await updateProgress(job_id, tenant_id, 'fetching', 10);
    let rawContent = '';
    
    if (source_type === 'url' && url) {
      // Mock fetch
      rawContent = 'Fetched content from URL';
    } else if (source_type === 'file' && file_path) {
      // Mock file read
      rawContent = 'Read content from file';
    } else {
      throw new Error('Invalid source_type or missing source data');
    }

    // 2. extracting
    await updateProgress(job_id, tenant_id, 'extracting', 30);
    const plainText = rawContent; // Mock text extraction

    // 3. chunking
    await updateProgress(job_id, tenant_id, 'chunking', 50);
    const chunks = [];
    for (let i = 0; i < plainText.length; i += 1000) {
      chunks.push({
        content: plainText.substring(i, i + 1000),
        article_number: null,
        section_title: null,
        point_number: null,
        page_number: null,
        source_url: url || null,
        source_title: null,
        metadata: {}
      });
    }
    chunksCreated = chunks.length;

    // 4. embedding
    await updateProgress(job_id, tenant_id, 'embedding', 70, chunksCreated);
    const embeddedChunks = chunks.map(chunk => ({
      ...chunk,
      embedding: Array(1536).fill(0.1) // Mock 1536-dimensional embedding
    }));

    // 5. indexing
    await updateProgress(job_id, tenant_id, 'indexing', 90, chunksCreated);
    const dbChunks = embeddedChunks.map(chunk => ({
      tenant_id,
      namespace_id,
      source_id,
      content: chunk.content,
      article_number: chunk.article_number,
      section_title: chunk.section_title,
      point_number: chunk.point_number,
      page_number: chunk.page_number,
      source_url: chunk.source_url,
      source_title: chunk.source_title,
      metadata: chunk.metadata,
      embedding: chunk.embedding
    }));
    
    // Ensure namespace and source exist
    await db.supabase.from('namespaces').upsert({ tenant_id, namespace_id }, { onConflict: 'tenant_id, namespace_id' });
    await db.supabase.from('sources').upsert({ tenant_id, namespace_id, source_id, source_type, url }, { onConflict: 'tenant_id, namespace_id, source_id' });
    
    const { error } = await db.supabase.from('chunks').insert(dbChunks);
    if (error) throw error;

    // 6. done
    await updateProgress(job_id, tenant_id, 'done', 100, chunksCreated);

  } catch (err: any) {
    await db.supabase
      .from('ingest_jobs')
      .update({
        status: 'failed',
        error_code: 'internal_error',
        error_message: err.message,
        error_retryable: true,
        completed_at: new Date().toISOString()
      })
      .eq('job_id', job_id)
      .eq('tenant_id', tenant_id);
    throw err;
  }
}, { connection });

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed with ${err.message}`);
});

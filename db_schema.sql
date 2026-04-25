CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE namespaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    namespace_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, namespace_id)
);

CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    namespace_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    url TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, namespace_id, source_id),
    FOREIGN KEY (tenant_id, namespace_id) REFERENCES namespaces(tenant_id, namespace_id) ON DELETE CASCADE
);

CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    namespace_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    content TEXT NOT NULL,
    article_number TEXT,
    section_title TEXT,
    point_number TEXT,
    page_number INT,
    source_url TEXT,
    source_title TEXT,
    metadata JSONB,
    embedding VECTOR(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (tenant_id, namespace_id, source_id) REFERENCES sources(tenant_id, namespace_id, source_id) ON DELETE CASCADE
);

CREATE TYPE ingest_status AS ENUM ('queued', 'fetching', 'extracting', 'chunking', 'embedding', 'indexing', 'done', 'failed', 'cancelled');
CREATE TYPE ingest_stage AS ENUM ('queued', 'fetching', 'extracting', 'chunking', 'embedding', 'indexing', 'done');

CREATE TABLE ingest_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id TEXT UNIQUE NOT NULL,
    tenant_id TEXT NOT NULL,
    idempotency_key UUID NOT NULL,
    namespace_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    status ingest_status DEFAULT 'queued',
    progress_stage ingest_stage DEFAULT 'queued',
    progress_percent INT DEFAULT 0,
    progress_chunks_created INT DEFAULT 0,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    estimated_completion_at TIMESTAMPTZ,
    payload_hash TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    error_retryable BOOLEAN,
    UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_namespaces_tenant ON namespaces(tenant_id);
CREATE INDEX idx_sources_tenant_namespace ON sources(tenant_id, namespace_id);
CREATE INDEX idx_chunks_tenant_namespace_source ON chunks(tenant_id, namespace_id, source_id);
CREATE INDEX idx_ingest_jobs_tenant_job ON ingest_jobs(tenant_id, job_id);

-- Required RPC function for similarity search
CREATE OR REPLACE FUNCTION match_chunks (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_tenant_id text,
  filter_namespace_ids text[]
)
RETURNS TABLE (
  id uuid,
  tenant_id text,
  namespace_id text,
  source_id text,
  content text,
  article_number text,
  section_title text,
  point_number text,
  page_number int,
  source_url text,
  source_title text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    chunks.id,
    chunks.tenant_id,
    chunks.namespace_id,
    chunks.source_id,
    chunks.content,
    chunks.article_number,
    chunks.section_title,
    chunks.point_number,
    chunks.page_number,
    chunks.source_url,
    chunks.source_title,
    chunks.metadata,
    1 - (chunks.embedding <=> query_embedding) AS similarity
  FROM chunks
  WHERE
    chunks.tenant_id = filter_tenant_id
    AND chunks.namespace_id = ANY(filter_namespace_ids)
    AND 1 - (chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

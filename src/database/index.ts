import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class Database {
  public supabase: SupabaseClient;

  constructor() {
    const env = (globalThis as any).process?.env || {};
    this.supabase = createClient(
      env.SUPABASE_URL || 'https://mock.supabase.co',
      env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key'
    );
  }

  async getJobByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    const { data, error } = await this.supabase
      .from('ingest_jobs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async createIngestJob(jobData: any) {
    const { data, error } = await this.supabase
      .from('ingest_jobs')
      .insert([jobData])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async similaritySearch(tenantId: string, namespaceIds: string[], embedding: number[], topK: number = 10) {
    const { data, error } = await this.supabase.rpc('match_chunks', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: topK,
      filter_tenant_id: tenantId,
      filter_namespace_ids: namespaceIds
    });

    if (error) throw error;
    return data;
  }

  async deleteSource(tenantId: string, namespaceId: string, sourceId: string) {
    const { error } = await this.supabase
      .from('sources')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('namespace_id', namespaceId)
      .eq('source_id', sourceId);

    if (error) throw error;
  }

  async deleteNamespace(tenantId: string, namespaceId: string) {
    const { error } = await this.supabase
      .from('namespaces')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('namespace_id', namespaceId);

    if (error) throw error;
  }
}

export const db = new Database();

import { Router, Request, Response } from 'express';
import { requireHeaders } from '../middleware/headers';
import { db } from '../database';
import { llmService } from '../services/llm';

const router = Router();

router.post('/', requireHeaders(['Authorization', 'X-Request-ID', 'X-Tenant-ID']), async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] as string;
  const tenantId = req.headers['x-tenant-id'] as string;

  try {
    const { 
      question, 
      language, 
      namespaces, 
      top_k = 10, 
      hint_article_number, 
      rerank = true, 
      include_answer = true, 
      conversation_history = [], 
      style_hints = {} 
    } = req.body;

    // Validate required fields
    if (!question || !language || !namespaces || namespaces.length === 0) {
      return res.status(400).json({ 
        error: { code: 'invalid_request', message: 'Missing required fields', request_id: requestId } 
      });
    }

    if (language !== 'ro') {
      return res.status(422).json({
        error: { code: 'validation_error', message: 'Only "ro" language is supported', request_id: requestId }
      });
    }

    if (top_k < 1 || top_k > 50) {
      return res.status(422).json({
        error: { code: 'validation_error', message: 'top_k must be between 1 and 50', request_id: requestId }
      });
    }

    // 1. Embed the question
    const questionEmbedding = await llmService.createEmbedding(question);

    // 2. Retrieve top_k chunks using vector similarity
    const chunksResult = await db.similaritySearch(tenantId, namespaces, questionEmbedding, top_k);
    const chunks = (chunksResult || []) as any[];

    // 3. If no results
    if (chunks.length === 0) {
      return res.status(200).json({
        request_id: requestId,
        answer: null,
        citations: [],
        usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0, model_id: 'none' },
        latency_ms: Date.now() - startTime,
        model_version: 'none',
        retrieval_strategy: 'vector_search',
        confidence: 0.0,
        trace_id: `trace_${Date.now()}`
      });
    }

    // 4. If results exist: build context and citation mapping
    let contextText = '';
    const citations: any[] = [];
    let cumulativeSimilarity = 0;

    chunks.forEach((chunk: any, index: number) => {
      const marker = `[${index + 1}]`;
      contextText += `${marker} ${chunk.content}\n\n`;
      cumulativeSimilarity += chunk.similarity;

      citations.push({
        marker,
        chunk: {
          chunk_id: chunk.id,
          content: chunk.content,
          article_number: chunk.article_number,
          section_title: chunk.section_title,
          point_number: chunk.point_number,
          page_number: chunk.page_number,
          source_id: chunk.source_id,
          source_url: chunk.source_url,
          source_title: chunk.source_title,
          namespace_id: chunk.namespace_id,
          score: chunk.similarity,
          metadata: chunk.metadata || {}
        }
      });
    });

    const confidence = cumulativeSimilarity / chunks.length;

    // If caller only wants retrieval (no answer generation)
    if (!include_answer) {
      return res.status(200).json({
        request_id: requestId,
        answer: null,
        citations,
        usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0, model_id: 'none' },
        latency_ms: Date.now() - startTime,
        model_version: 'none',
        retrieval_strategy: 'vector_search',
        confidence,
        trace_id: `trace_${Date.now()}`
      });
    }

    // Generate plain text answer with inline citations
    const { answer, usage, modelVersion } = await llmService.generateAnswer(
      question, 
      contextText, 
      style_hints
    );

    // 5. Return payload exactly matching OpenAPI spec
    res.status(200).json({
      request_id: requestId,
      answer,
      citations,
      usage,
      latency_ms: Date.now() - startTime,
      model_version: modelVersion,
      retrieval_strategy: 'vector_search',
      confidence,
      trace_id: `trace_${Date.now()}`
    });

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ 
      error: { code: 'internal_error', message: 'Failed to process query', request_id: requestId } 
    });
  }
});

export default router;

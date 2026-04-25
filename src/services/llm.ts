import OpenAI from 'openai';

export class LLMService {
  private openai: OpenAI;

  constructor() {
    const env = (globalThis as any).process?.env || {};
    this.openai = new OpenAI({
      apiKey: env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || '',
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/antigravity-rag-api', // Optional
        'X-Title': 'RAG API', // Optional
      }
    });
  }

  async createEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'openai/text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }

  async generateAnswer(question: string, context: string, styleHints: any): Promise<{ answer: string, usage: any, modelVersion: string }> {
    const prompt = `
      Answer the question using ONLY the provided context.
      
      Rules:
      1. Use plain text ONLY. DO NOT use markdown, bold, italics, or lists.
      2. Cite the context inline using the provided markers (e.g., [1], [2]).
      3. Tone: ${styleHints?.tone || 'formal'}
      4. Maximum length: ${styleHints?.answer_max_chars || 2000} characters.
      5. If the context does not contain the answer, say so.
      
      Context:
      ${context}
      
      Question:
      ${question}
    `;

    const env = (globalThis as any).process?.env || {};
    const model = styleHints?.model || env.LLM_MODEL || 'google/gemini-2.0-flash-001';
    
    const response = await this.openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: prompt }],
    });

    const answer = response.choices[0].message.content || '';
    
    return {
      answer: answer.substring(0, styleHints?.answer_max_chars || 2000),
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
        cost_usd: 0, // OpenRouter doesn't return cost directly in the same way
        model_id: model
      },
      modelVersion: model
    };
  }
}

export const llmService = new LLMService();

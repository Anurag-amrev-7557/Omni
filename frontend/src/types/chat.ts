export interface ContextChunk {
  filename?: string;
  source?: string;
  parent_content?: string;
  content?: string;
  page?: number;
  score?: number;
  rerank_score?: number;
  rrf_score?: number;
  vector_score?: number;
  bm25_score?: number;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  contexts?: ContextChunk[] | null;
  created_at?: string;
  timestamp?: string;
}

export interface ChatSession {
  session_id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
  category?: string;
  is_starred?: boolean;
}

export interface ModelOption {
  name: string;
  desc: string;
}

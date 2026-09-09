import { ChatSession, ChatMessage } from '../types/chat';
import { DocumentItem, CollectionStats, UploadResponse } from '../types/document';

export interface HealthResponse {
  status: 'healthy' | 'degraded' | string;
  version: string;
  timestamp: number;
  pipeline?: {
    qdrant?: {
      status: string;
      collection?: string;
      vector_count?: number;
      dimension?: number;
      error?: string;
    };
    graph_db?: {
      status: string;
      entities?: number;
      relations?: number;
      error?: string;
    };
    llm?: {
      provider: string;
      status: string;
      default_model: string;
    };
    embeddings?: {
      status: string;
      model: string;
      dimension: number;
      mode: string;
    };
  };
}

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') || "http://127.0.0.1:8000";


let tokenProvider: (() => Promise<string | null>) | null = null;
let cachedToken: string | null = null;

export const setAuthTokenProvider = (provider: () => Promise<string | null>) => {
  tokenProvider = provider;
  provider().then(t => {
    cachedToken = t;
  }).catch(() => {
    cachedToken = null;
  });
};

export const setCachedToken = (token: string | null) => {
  cachedToken = token;
};

export const getCachedToken = (): string | null => cachedToken;

export const getAuthToken = async (): Promise<string | null> => {
  if (cachedToken !== null && cachedToken !== undefined) {
    return cachedToken;
  }
  if (tokenProvider) {
    try {
      const t = await tokenProvider();
      cachedToken = t;
      return t;
    } catch {
      return cachedToken;
    }
  }
  return cachedToken;
};

export const getGuestSessionId = (): string => {
  if (typeof window === 'undefined') return 'guest_default';
  let guestId = sessionStorage.getItem('omni_guest_session_id');
  if (!guestId) {
    const randomHex = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    guestId = `guest_${randomHex}`;
    sessionStorage.setItem('omni_guest_session_id', guestId);
  }
  return guestId;
};

export const clearUserDataOnLogout = () => {
  cachedToken = null;
  if (typeof window === 'undefined') return;

  try {
    // 1. Explicit fixed user/session data keys
    const userKeys = [
      'omni_sessions_cache',
      'omni_active_session_id',
      'omni_active_project',
      'omni_projects',
      'omni_documents_cache',
      'omni_stats_cache',
      'omni_custom_instructions',
      'omni_user_name',
      'omni_call_name',
      'omni_work_domain',
    ];
    userKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });

    // 2. Clear all dynamic per-session message cache keys (omni_msgs_*)
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('omni_msgs_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });

    // 3. Clear guest session ID in sessionStorage so the next guest session starts clean
    try { sessionStorage.removeItem('omni_guest_session_id'); } catch {}
  } catch (err) {
    console.error('Failed to clear user data on logout:', err);
  }
};

export const apiFetch = async (path: string, options: RequestInit = {}) => {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  if (token && token !== 'null' && token !== 'undefined') {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    // Unauthenticated guest user: scope requests with ephemeral guest session ID
    headers.set('X-Guest-Id', getGuestSessionId());
  }
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-cache, no-store');
  if (!headers.has('Pragma')) headers.set('Pragma', 'no-cache');
  
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...options, headers });
    if (res.status === 401 && token) {
      cachedToken = null;
    }
    return res;
  } catch (error: any) {
    // Network error or server unreachable
    throw new Error(`Network error: ${error.message || 'Server unreachable'}`);
  }
};

export const api = {
  // Session APIs
  async getSessions(): Promise<ChatSession[]> {
    const res = await apiFetch('/api/sessions');
    if (!res.ok) throw new Error(`Failed to load sessions (HTTP ${res.status})`);
    const data = await res.json();
    return data.sessions || [];
  },

  async createSession(title: string = 'New chat', sessionId?: string): Promise<{ session_id: string; title: string }> {
    const res = await apiFetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, session_id: sessionId })
    });
    return res.json();
  },

  async deleteSession(sessionId: string): Promise<void> {
    await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  },

  // Message APIs
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const res = await apiFetch(`/api/sessions/${sessionId}/messages`);
    if (!res.ok) throw new Error(`Failed to load messages (HTTP ${res.status})`);
    const data = await res.json();
    return data.messages || [];
  },

  // Document APIs
  async getDocuments(): Promise<DocumentItem[]> {
    const res = await apiFetch('/api/documents');
    if (!res.ok) throw new Error(`Failed to load documents (HTTP ${res.status})`);
    const data = await res.json();
    return data.documents || [];
  },

  async getStats(): Promise<CollectionStats> {
    const res = await apiFetch('/api/stats');
    return res.json();
  },

  async getHealth(): Promise<HealthResponse> {
    try {
      const res = await apiFetch('/api/health');
      if (!res.ok) return { status: 'degraded', version: '2.0.0', timestamp: Date.now() / 1000 };
      return res.json();
    } catch {
      return { status: 'offline', version: '2.0.0', timestamp: Date.now() / 1000 };
    }
  },

  async uploadDocuments(files: FileList | File[]): Promise<UploadResponse> {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    const res = await apiFetch('/api/upload', { 
      method: 'POST', 
      body: formData,
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || `Upload failed with status ${res.status}`);
    }
    
    return res.json();
  },

  async deleteDocument(filename: string): Promise<{ success: boolean }> {
    const res = await apiFetch(`/api/documents/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  async batchDeleteDocuments(filenames: string[]): Promise<{ success: boolean; deleted: string[] }> {
    const res = await apiFetch('/api/documents/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames }),
    });
    return res.json();
  },

  async reindexDocument(filename: string): Promise<{ success: boolean }> {
    const res = await apiFetch(`/api/documents/${encodeURIComponent(filename)}/reindex`, {
      method: 'POST'
    });
    return res.json();
  },

  async enhanceDocument(filename: string, options?: { extract_graph?: boolean; generate_summary?: boolean }): Promise<{ 
    success: boolean; 
    filename: string; 
    processing_time: number;
    features_enabled: { knowledge_graph: boolean; ai_summary: boolean };
  }> {
    const params = new URLSearchParams();
    if (options?.extract_graph !== undefined) params.set('extract_graph', String(options.extract_graph));
    if (options?.generate_summary !== undefined) params.set('generate_summary', String(options.generate_summary));
    
    const queryString = params.toString();
    const url = `/api/documents/${encodeURIComponent(filename)}/enhance${queryString ? `?${queryString}` : ''}`;
    
    const res = await apiFetch(url, { method: 'POST' });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Enhancement failed' }));
      throw new Error(error.detail || `Enhancement failed with status ${res.status}`);
    }
    
    return res.json();
  },

  async batchEnhanceDocuments(filenames: string[], options?: { extract_graph?: boolean; generate_summary?: boolean }): Promise<{
    success: boolean;
    total_files: number;
    successful: number;
    failed: number;
    total_time: number;
    results: Array<{ filename: string; success: boolean; error?: string; processing_time?: number }>;
  }> {
    const params = new URLSearchParams();
    if (options?.extract_graph !== undefined) params.set('extract_graph', String(options.extract_graph));
    if (options?.generate_summary !== undefined) params.set('generate_summary', String(options.generate_summary));
    
    const queryString = params.toString();
    const url = `/api/documents/batch-enhance${queryString ? `?${queryString}` : ''}`;
    
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filenames)
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Batch enhancement failed' }));
      throw new Error(error.detail || `Batch enhancement failed with status ${res.status}`);
    }
    
    return res.json();
  },

  async getFileContent(filename: string): Promise<{ filename: string; content: string }> {
    const res = await apiFetch(`/api/file-content?filename=${encodeURIComponent(filename)}`);
    return res.json();
  },

  async getPdfInfo(filename: string): Promise<{ filename: string; total_pages: number }> {
    const res = await apiFetch(`/api/pdf-info?filename=${encodeURIComponent(filename)}`);
    return res.json();
  },

  async resetCollection(): Promise<{ success: boolean }> {
    const res = await apiFetch('/api/reset', { method: 'POST' });
    return res.json();
  },

  getDownloadUrl(filename: string): string {
    const guestId = getGuestSessionId();
    const token = getCachedToken();
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (guestId) params.set('guest_id', guestId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return `${API_BASE}/api/download/${encodeURIComponent(filename)}${qs}`;
  },

  getPdfPageImageUrl(filename: string, page: number): string {
    const guestId = getGuestSessionId();
    const token = getCachedToken();
    const params = new URLSearchParams({
      filename,
      page: String(page),
    });
    if (token) params.set('token', token);
    if (guestId) params.set('guest_id', guestId);
    return `${API_BASE}/api/pdf-page-image?${params.toString()}`;
  },

  // Knowledge Graph APIs
  async getGraph(): Promise<any> {
    const res = await apiFetch(`/api/graph?_t=${Date.now()}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch knowledge graph: ${res.statusText}`);
    }
    return res.json();
  },

  async buildGraph(forceRebuild = true): Promise<{ status: string; message: string }> {
    const res = await apiFetch(`/api/graph/build?force_rebuild=${forceRebuild ? 'true' : 'false'}`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error(`Failed to trigger graph build: ${res.statusText}`);
    }
    return res.json();
  },

  async getCommunities(): Promise<{ communities: any[]; total: number }> {
    const res = await apiFetch('/api/graph/communities');
    if (!res.ok) {
      throw new Error(`Failed to fetch communities: ${res.statusText}`);
    }
    return res.json();
  },

  async updateCommunities(): Promise<any> {
    const res = await apiFetch('/api/graph/update-communities', { method: 'POST' });
    if (!res.ok) {
      throw new Error(`Failed to update communities: ${res.statusText}`);
    }
    return res.json();
  },

  // GitHub Connector APIs
  async githubPreview(data: { repo?: string; repo_url?: string; branch?: string; subfolder?: string; token?: string }): Promise<any> {
    const res = await apiFetch('/api/github/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Preview failed (${res.status})`);
    }
    return res.json();
  },

  async uploadSingleDocument(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('files', file);
    const res = await apiFetch('/api/upload', { 
      method: 'POST', 
      body: formData,
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || `Upload failed with status ${res.status}`);
    }
    
    return res.json();
  },

  async uploadSingleDocumentStream(
    file: File,
    onProgress: (event: { type: string; stage?: string; progress?: number; message?: string; error?: string }) => void
  ): Promise<{ success: boolean; filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiFetch('/api/upload-stream', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Upload stream failed' }));
      throw new Error(error.detail || `Upload failed with status ${res.status}`);
    }
    if (!res.body) throw new Error("Response body is not readable");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          onProgress(parsed);
          if (parsed.type === 'done' && parsed.success) {
            completed = true;
          } else if (parsed.type === 'error') {
            throw new Error(parsed.error || 'Server error during ingestion');
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Server error')) throw e;
          console.error("Error parsing upload stream line:", e, line);
        }
      }
    }

    return { success: completed, filename: file.name };
  },

  async githubSyncStream(
    data: { repo?: string; repo_url?: string; branch?: string; files?: string[]; selected_paths?: string[]; token?: string },
    onProgress: (event: any) => void
  ): Promise<any> {
    const res = await apiFetch('/api/github/sync-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Sync failed (${res.status})`);
    }
    if (!res.body) throw new Error("Response body is not readable");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          onProgress(parsed);
          if (parsed.type === 'done') {
            finalResult = parsed;
          }
        } catch (e) {
          console.error("Error parsing sync stream line:", e, line);
        }
      }
    }
    return finalResult;
  },
};


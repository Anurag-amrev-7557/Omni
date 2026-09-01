import { ChatSession, ChatMessage } from '../types/chat';
import { DocumentItem, CollectionStats, PipelineHealth, UploadResponse, UploadProgress } from '../types/document';

export const API_BASE = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
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

export const getCachedToken = (): string | null => cachedToken;

const apiFetch = async (path: string, options: RequestInit = {}) => {
  const token = await tokenProvider?.();
  if (token) cachedToken = token;
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...options, headers });
};

export const api = {
  // Session APIs
  async getSessions(): Promise<ChatSession[]> {
    const res = await apiFetch('/api/sessions');
    const data = await res.json();
    return data.sessions || [];
  },

  async createSession(title: string = 'New chat'): Promise<{ session_id: string; title: string }> {
    const res = await apiFetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    return res.json();
  },

  async deleteSession(sessionId: string): Promise<void> {
    await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  },

  // Message APIs
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const res = await apiFetch(`/api/sessions/${sessionId}/messages`);
    const data = await res.json();
    return data.messages || [];
  },

  // Document APIs
  async getDocuments(): Promise<DocumentItem[]> {
    const res = await apiFetch('/api/documents');
    const data = await res.json();
    return data.documents || [];
  },

  async getStats(): Promise<CollectionStats> {
    const res = await apiFetch('/api/stats');
    return res.json();
  },

  async getHealth(): Promise<PipelineHealth> {
    const res = await apiFetch('/api/health');
    return res.json();
  },

  uploadDocuments(
    files: FileList | File[],
    onProgress?: (percent: number) => void
  ): Promise<UploadResponse> {
    return new Promise(async (resolve, reject) => {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
      
      const token = await tokenProvider?.();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/upload`);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        try {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            const err = JSON.parse(xhr.responseText || '{}');
            reject(new Error(err.detail || `Upload failed with status ${xhr.status}`));
          }
        } catch (e) {
          reject(e);
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });
  },

  async getUploadProgress(uploadId: string): Promise<UploadProgress> {
    const res = await apiFetch(`/api/upload-progress/${uploadId}`);
    return res.json();
  },

  async deleteDocument(filename: string): Promise<{ success: boolean }> {
    const res = await apiFetch(`/api/documents/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  async reindexDocument(filename: string): Promise<{ success: boolean }> {
    const res = await apiFetch(`/api/documents/${encodeURIComponent(filename)}/reindex`, {
      method: 'POST'
    });
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

  async cleanupOrphaned(): Promise<{ success: boolean; cleaned: number; orphaned_files: string[]; message: string }> {
    const res = await apiFetch('/api/cleanup-orphaned', { method: 'POST' });
    return res.json();
  },

  async transcribeAudio(audioBlob: Blob): Promise<{ success: boolean; text: string }> {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    const res = await apiFetch('/api/audio/transcribe', {
      method: 'POST',
      body: formData
    });
    return res.json();
  },

  async submitFeedback(data: { session_id?: string; message_id?: string; rating: boolean; feedback?: string }): Promise<{ success: boolean; feedback_id: string }> {
    const res = await apiFetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async getPdfPageImageBlob(filename: string, page: number): Promise<string> {
    const res = await apiFetch(`/api/pdf-page-image?filename=${encodeURIComponent(filename)}&page=${page}`);
    if (!res.ok) throw new Error("Failed to load PDF page image");
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async downloadFile(filename: string): Promise<void> {
    const res = await apiFetch(`/api/download/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  getDownloadUrl(filename: string): string {
    const token = cachedToken;
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${API_BASE}/api/download/${encodeURIComponent(filename)}${tokenQuery}`;
  },

  getPdfPageImageUrl(filename: string, page: number): string {
    const token = cachedToken;
    const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
    return `${API_BASE}/api/pdf-page-image?filename=${encodeURIComponent(filename)}&page=${page}${tokenQuery}`;
  }
};

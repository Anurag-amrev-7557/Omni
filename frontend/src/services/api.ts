import { ChatSession, ChatMessage } from '../types/chat';
import { DocumentItem, CollectionStats, UploadResponse } from '../types/document';

export const API_BASE = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

export const api = {
  // Session APIs
  async getSessions(): Promise<ChatSession[]> {
    const res = await fetch(`${API_BASE}/api/sessions`);
    const data = await res.json();
    return data.sessions || [];
  },

  async createSession(title: string = 'New chat'): Promise<{ session_id: string; title: string }> {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    return res.json();
  },

  async deleteSession(sessionId: string): Promise<void> {
    await fetch(`${API_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' });
  },

  // Message APIs
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`);
    const data = await res.json();
    return data.messages || [];
  },

  // Document APIs
  async getDocuments(): Promise<DocumentItem[]> {
    const res = await fetch(`${API_BASE}/api/documents`);
    const data = await res.json();
    return data.documents || [];
  },

  async getStats(): Promise<CollectionStats> {
    const res = await fetch(`${API_BASE}/api/stats`);
    return res.json();
  },

  async uploadDocuments(files: FileList | File[]): Promise<UploadResponse> {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData });
    return res.json();
  },

  async deleteDocument(filename: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/api/documents/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  async reindexDocument(filename: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/api/documents/${encodeURIComponent(filename)}/reindex`, {
      method: 'POST'
    });
    return res.json();
  },

  async getFileContent(filename: string): Promise<{ filename: string; content: string }> {
    const res = await fetch(`${API_BASE}/api/file-content?filename=${encodeURIComponent(filename)}`);
    return res.json();
  },

  async getPdfInfo(filename: string): Promise<{ filename: string; total_pages: number }> {
    const res = await fetch(`${API_BASE}/api/pdf-info?filename=${encodeURIComponent(filename)}`);
    return res.json();
  },

  async resetCollection(): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/api/reset`, { method: 'POST' });
    return res.json();
  },

  async cleanupOrphaned(): Promise<{ success: boolean; cleaned: number; orphaned_files: string[]; message: string }> {
    const res = await fetch(`${API_BASE}/api/cleanup-orphaned`, { method: 'POST' });
    return res.json();
  },

  getDownloadUrl(filename: string): string {
    return `${API_BASE}/api/download/${encodeURIComponent(filename)}`;
  },

  getPdfPageImageUrl(filename: string, page: number): string {
    return `${API_BASE}/api/pdf-page-image?filename=${encodeURIComponent(filename)}&page=${page}`;
  }
};

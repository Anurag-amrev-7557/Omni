import { useState, useEffect, useCallback } from 'react';
import { DocumentItem, CollectionStats } from '../types/document';
import { api } from '../services/api';

export const useDocuments = (showToast: (msg: string) => void) => {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [stats, setStats] = useState<CollectionStats>({
    total_chunks: 0,
    files_count: 0,
    files: []
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      const docs = await api.getDocuments();
      setDocuments(docs);
    } catch (e) {
      console.error("Error fetching documents:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const s = await api.getStats();
      setStats(s);
    } catch (e) {
      console.error("Error fetching stats:", e);
    }
  }, []);

  const refreshVault = useCallback(async () => {
    await Promise.all([fetchDocuments(), fetchStats()]);
  }, [fetchDocuments, fetchStats]);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      showToast(`Ingesting ${files.length} file(s) into vector vault...`);
      const res = await api.uploadDocuments(files);
      if (res.success) {
        showToast(`Successfully indexed ${res.ingested_count} document(s)`);
      } else {
        showToast("Upload completed with warnings");
      }
      await refreshVault();
    } catch (e) {
      console.error("Upload error:", e);
      showToast("Error ingesting documents");
    } finally {
      setIsUploading(false);
    }
  };

  const deleteDocument = async (filename: string) => {
    if (!window.confirm(`Delete "${filename}" and its vector embeddings from Qdrant?`)) return;
    try {
      const res = await api.deleteDocument(filename);
      if (res.success) {
        showToast(`Removed "${filename}" from vault`);
        await refreshVault();
      }
    } catch (e) {
      console.error("Delete error:", e);
      showToast("Failed to delete document");
    }
  };

  const reindexDocument = async (filename: string) => {
    try {
      showToast(`Re-indexing "${filename}"...`);
      const res = await api.reindexDocument(filename);
      if (res.success) {
        showToast(`Re-indexed "${filename}" successfully`);
        await refreshVault();
      }
    } catch (e) {
      console.error("Reindex error:", e);
      showToast("Failed to re-index document");
    }
  };

  const downloadDocument = (filename: string) => {
    window.open(api.getDownloadUrl(filename), '_blank');
  };

  // Mass / Batch Operations
  const batchDeleteDocuments = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    if (!window.confirm(`Delete ${filenames.length} selected document(s) and their vector embeddings from Qdrant?`)) return;
    try {
      showToast(`Deleting ${filenames.length} document(s)...`);
      for (const fn of filenames) {
        await api.deleteDocument(fn);
      }
      showToast(`Successfully deleted ${filenames.length} document(s)`);
      await refreshVault();
    } catch (e) {
      console.error("Batch delete error:", e);
      showToast("Failed to delete some documents");
    }
  };

  const batchReindexDocuments = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    try {
      showToast(`Re-indexing ${filenames.length} document(s)...`);
      for (const fn of filenames) {
        await api.reindexDocument(fn);
      }
      showToast(`Successfully re-indexed ${filenames.length} document(s)`);
      await refreshVault();
    } catch (e) {
      console.error("Batch reindex error:", e);
      showToast("Failed to reindex some documents");
    }
  };

  const batchDownloadDocuments = (filenames: string[]) => {
    if (filenames.length === 0) return;
    filenames.forEach(fn => downloadDocument(fn));
    showToast(`Downloaded ${filenames.length} document(s)`);
  };

  const cleanupOrphaned = async () => {
    try {
      showToast("Cleaning up orphaned vectors...");
      const res = await api.cleanupOrphaned();
      if (res.success) {
        showToast(`Cleaned up ${res.cleaned} orphaned file(s)`);
        await refreshVault();
      }
    } catch (e) {
      console.error("Cleanup error:", e);
      showToast("Failed to cleanup orphaned files");
    }
  };

  return {
    documents,
    stats,
    isLoading,
    isUploading,
    fetchDocuments,
    fetchStats,
    refreshVault,
    uploadFiles,
    deleteDocument,
    reindexDocument,
    downloadDocument,
    batchDeleteDocuments,
    batchReindexDocuments,
    batchDownloadDocuments,
    cleanupOrphaned,
  };
};

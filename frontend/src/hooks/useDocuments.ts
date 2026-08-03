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
    } catch (e: any) {
      console.error("Error fetching documents:", e);
      showToast(`Failed to fetch documents: ${e?.message || "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await api.getStats();
      setStats(s);
    } catch (e: any) {
      console.error("Error fetching stats:", e);
      // Don't show toast for stats errors as they're less critical
    }
  }, []);

  const addDocumentOptimistic = useCallback((doc: DocumentItem) => {
    setDocuments(prev => {
      const idx = prev.findIndex(d => d.filename === doc.filename);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...doc };
        return next;
      }
      return [doc, ...prev];
    });
  }, []);

  const refreshVault = useCallback(async () => {
    try {
      await Promise.all([fetchDocuments(), fetchStats()]);
    } catch (error) {
      console.error("Error refreshing vault:", error);
      throw error; // Re-throw so caller can handle
    }
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

      // Immediately sync state with documents list returned from upload endpoint
      if (res.documents && Array.isArray(res.documents)) {
        setDocuments(res.documents);
      }

      // Concurrently ensure latest collection stats & documents are synced
      await refreshVault();

      if (res.errors && res.errors.length > 0) {
        const errorMsg = res.ingested_count > 0 
          ? `Indexed ${res.ingested_count} file(s), but ${res.errors.length} failed: ${res.errors[0]}`
          : `Upload failed: ${res.errors[0]}`;
        showToast(errorMsg);
      } else if (res.success && res.ingested_count > 0) {
        showToast(`✓ Successfully indexed ${res.ingested_count} document(s)`);
      } else {
        showToast("⚠ Upload finished: 0 documents indexed");
      }
    } catch (e: any) {
      console.error("Upload error:", e);
      const errorMsg = e?.message || "Error ingesting documents";
      showToast(`✗ Upload failed: ${errorMsg}`);
    } finally {
      setIsUploading(false);
    }
  };

  const deleteDocument = async (filename: string) => {
    if (!window.confirm(`Delete "${filename}" and its vector embeddings from Qdrant?`)) return;
    try {
      showToast(`Deleting "${filename}"...`);
      const res = await api.deleteDocument(filename);
      if (res.success) {
        showToast(`✓ Removed "${filename}" from vault`);
        await refreshVault();
      } else {
        throw new Error("Delete operation returned unsuccessful");
      }
    } catch (e: any) {
      console.error("Delete error:", e);
      showToast(`✗ Failed to delete "${filename}": ${e?.message || "Unknown error"}`);
    }
  };

  const reindexDocument = async (filename: string) => {
    try {
      showToast(`Re-indexing "${filename}"...`);
      const res = await api.reindexDocument(filename);
      if (res.success) {
        showToast(`✓ Re-indexed "${filename}" successfully`);
        await refreshVault();
      } else {
        throw new Error("Reindex operation returned unsuccessful");
      }
    } catch (e: any) {
      console.error("Reindex error:", e);
      showToast(`✗ Failed to re-index "${filename}": ${e?.message || "Unknown error"}`);
    }
  };

  const enhanceDocument = async (filename: string, options?: { extractGraph?: boolean; generateSummary?: boolean }) => {
    try {
      const features = [];
      if (options?.extractGraph) features.push("knowledge graph");
      if (options?.generateSummary) features.push("AI summary");
      
      showToast(`Enhancing "${filename}" with ${features.join(" and ")}...`);
      const res = await api.enhanceDocument(filename, {
        extract_graph: options?.extractGraph ?? true,
        generate_summary: options?.generateSummary ?? true
      });
      
      if (res.success) {
        showToast(`✓ Enhanced "${filename}" successfully (${res.processing_time}s)`);
        await refreshVault();
      } else {
        throw new Error("Enhancement operation returned unsuccessful");
      }
    } catch (e: any) {
      console.error("Enhancement error:", e);
      showToast(`✗ Failed to enhance "${filename}": ${e?.message || "Unknown error"}`);
    }
  };

  const batchEnhanceDocuments = async (filenames: string[], options?: { extractGraph?: boolean; generateSummary?: boolean }) => {
    if (filenames.length === 0) return;
    
    try {
      const features = [];
      if (options?.extractGraph) features.push("knowledge graph");
      if (options?.generateSummary) features.push("AI summary");
      
      showToast(`Enhancing ${filenames.length} document(s) with ${features.join(" and ")}...`);
      const res = await api.batchEnhanceDocuments(filenames, {
        extract_graph: options?.extractGraph ?? true,
        generate_summary: options?.generateSummary ?? true
      });
      
      await refreshVault();
      
      if (res.failed === 0) {
        showToast(`✓ Enhanced ${res.successful} document(s) successfully (${res.total_time}s total)`);
      } else {
        showToast(`⚠ Enhanced ${res.successful} document(s), ${res.failed} failed`);
      }
    } catch (e: any) {
      console.error("Batch enhancement error:", e);
      showToast(`✗ Batch enhancement failed: ${e?.message || "Unknown error"}`);
    }
  };

  const downloadDocument = (filename: string) => {
    window.open(api.getDownloadUrl(filename), '_blank');
  };

  // Mass / Batch Operations
  const batchDeleteDocuments = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    if (!window.confirm(`Delete ${filenames.length} selected document(s) and their vector embeddings from Qdrant?`)) return;
    
    let successCount = 0;
    let failedCount = 0;
    
    try {
      showToast(`Deleting ${filenames.length} document(s)...`);
      
      for (const fn of filenames) {
        try {
          await api.deleteDocument(fn);
          successCount++;
        } catch (e) {
          console.error(`Failed to delete ${fn}:`, e);
          failedCount++;
        }
      }
      
      await refreshVault();
      
      if (failedCount === 0) {
        showToast(`✓ Successfully deleted ${successCount} document(s)`);
      } else {
        showToast(`⚠ Deleted ${successCount} document(s), ${failedCount} failed`);
      }
    } catch (e: any) {
      console.error("Batch delete error:", e);
      showToast(`✗ Batch delete failed: ${e?.message || "Unknown error"}`);
    }
  };

  const batchReindexDocuments = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    
    let successCount = 0;
    let failedCount = 0;
    
    try {
      showToast(`Re-indexing ${filenames.length} document(s)...`);
      
      for (const fn of filenames) {
        try {
          await api.reindexDocument(fn);
          successCount++;
        } catch (e) {
          console.error(`Failed to reindex ${fn}:`, e);
          failedCount++;
        }
      }
      
      await refreshVault();
      
      if (failedCount === 0) {
        showToast(`✓ Successfully re-indexed ${successCount} document(s)`);
      } else {
        showToast(`⚠ Re-indexed ${successCount} document(s), ${failedCount} failed`);
      }
    } catch (e: any) {
      console.error("Batch reindex error:", e);
      showToast(`✗ Batch reindex failed: ${e?.message || "Unknown error"}`);
    }
  };

  const batchDownloadDocuments = (filenames: string[]) => {
    if (filenames.length === 0) return;
    filenames.forEach(fn => downloadDocument(fn));
    showToast(`Downloaded ${filenames.length} document(s)`);
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
    addDocumentOptimistic,
    deleteDocument,
    reindexDocument,
    enhanceDocument,
    downloadDocument,
    batchDeleteDocuments,
    batchReindexDocuments,
    batchEnhanceDocuments,
    batchDownloadDocuments,
  };
};

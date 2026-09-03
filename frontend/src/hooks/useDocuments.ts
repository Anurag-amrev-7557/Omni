import { useState, useEffect, useCallback } from 'react';
import { DocumentItem, CollectionStats } from '../types/document';
import { api } from '../services/api';

export const useDocuments = (showToast: (msg: string) => void) => {
  const [documents, setDocuments] = useState<DocumentItem[]>(() => {
    try {
      const saved = localStorage.getItem('omni_documents_cache');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [stats, setStats] = useState<CollectionStats>(() => {
    try {
      const saved = localStorage.getItem('omni_stats_cache');
      return saved ? JSON.parse(saved) : {
        total_chunks: 0,
        files_count: 0,
        files: []
      };
    } catch {
      return {
        total_chunks: 0,
        files_count: 0,
        files: []
      };
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Sync cache with localStorage on updates (unconditional to allow caching empty array when all docs deleted)
  useEffect(() => {
    try {
      localStorage.setItem('omni_documents_cache', JSON.stringify(documents));
    } catch {}
  }, [documents]);

  useEffect(() => {
    try {
      localStorage.setItem('omni_stats_cache', JSON.stringify(stats));
    } catch {}
  }, [stats]);

  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      const docs = await api.getDocuments();
      setDocuments(docs);
      try {
        localStorage.setItem('omni_documents_cache', JSON.stringify(docs));
      } catch {}
    } catch (e: any) {
      console.warn("Server unavailable or cold-starting, keeping local document cache:", e);
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await api.getStats();
      setStats(s);
      try {
        localStorage.setItem('omni_stats_cache', JSON.stringify(s));
      } catch {}
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
    setStats(prev => {
      if (!prev.files.includes(doc.filename)) {
        return {
          ...prev,
          files_count: prev.files_count + 1,
          files: [doc.filename, ...prev.files],
        };
      }
      return prev;
    });
  }, []);

  const refreshVault = useCallback(async () => {
    try {
      await Promise.all([fetchDocuments(), fetchStats()]);
    } catch (error) {
      console.warn("Vault refresh note:", error);
    }
  }, [fetchDocuments, fetchStats]);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setIsUploading(true);

    // Snapshot state for potential rollback
    const previousDocs = documents;
    const previousStats = stats;

    // Build optimistic DocumentItem entries
    const optimisticDocs: DocumentItem[] = fileArray.map(file => ({
      filename: file.name,
      size_mb: parseFloat((file.size / (1024 * 1024)).toFixed(2)) || 0.01,
      pages: 1,
      indexed: false,
      status: 'indexing' as const,
      isOptimistic: true,
    }));

    // Optimistically prepend to documents state immediately!
    setDocuments(prev => {
      const existingNames = new Set(optimisticDocs.map(o => o.filename));
      const remaining = prev.filter(d => !existingNames.has(d.filename));
      return [...optimisticDocs, ...remaining];
    });

    // Optimistically update collection stats
    setStats(prev => ({
      ...prev,
      files_count: prev.files_count + optimisticDocs.length,
      files: Array.from(new Set([...optimisticDocs.map(o => o.filename), ...prev.files])),
    }));

    showToast(`Ingesting ${fileArray.length} file(s) into vector vault...`);

    try {
      const res = await api.uploadDocuments(files);

      // Immediately sync state with documents list returned from upload endpoint
      if (res.documents && Array.isArray(res.documents)) {
        setDocuments(res.documents);
      } else {
        // Mark optimistic documents as indexed
        setDocuments(prev => 
          prev.map(d => {
            const match = optimisticDocs.find(o => o.filename === d.filename);
            if (match) {
              return { ...d, indexed: true, status: 'indexed' as const, isOptimistic: false };
            }
            return d;
          })
        );
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
      // Rollback optimistic documents & stats
      setDocuments(previousDocs);
      setStats(previousStats);
      const errorMsg = e?.message || "Error ingesting documents";
      showToast(`✗ Upload failed: ${errorMsg}`);
    } finally {
      setIsUploading(false);
    }
  };

  const deleteDocument = async (filename: string) => {
    if (!window.confirm(`Delete "${filename}" and its vector embeddings from Qdrant?`)) return;

    // Snapshot for rollback
    const previousDocs = documents;
    const previousStats = stats;

    // Optimistically remove document from state and cache immediately!
    const nextDocs = documents.filter(d => d.filename !== filename);
    const nextStats = {
      ...stats,
      files_count: Math.max(0, stats.files_count - 1),
      files: stats.files.filter(f => f !== filename),
    };
    setDocuments(nextDocs);
    setStats(nextStats);
    try {
      localStorage.setItem('omni_documents_cache', JSON.stringify(nextDocs));
      localStorage.setItem('omni_stats_cache', JSON.stringify(nextStats));
    } catch {}
    showToast(`Removed "${filename}" from vault`);

    try {
      const res = await api.deleteDocument(filename);
      if (res.success) {
        // Refresh vault in background to ensure clean chunk count sync
        await refreshVault();
      } else {
        throw new Error("Delete operation returned unsuccessful");
      }
    } catch (e: any) {
      console.error("Delete error:", e);
      // Rollback immediately on failure
      setDocuments(previousDocs);
      setStats(previousStats);
      try {
        localStorage.setItem('omni_documents_cache', JSON.stringify(previousDocs));
        localStorage.setItem('omni_stats_cache', JSON.stringify(previousStats));
      } catch {}
      showToast(`✗ Failed to delete "${filename}": ${e?.message || "Unknown error"}`);
    }
  };

  const reindexDocument = async (filename: string) => {
    // Snapshot previous document state
    const previousDoc = documents.find(d => d.filename === filename);

    // Optimistically set document status to indexing
    setDocuments(prev => 
      prev.map(d => d.filename === filename ? { ...d, indexed: false, status: 'indexing' as const } : d)
    );
    showToast(`Re-indexing "${filename}"...`);

    try {
      const res = await api.reindexDocument(filename);
      if (res.success) {
        setDocuments(prev => 
          prev.map(d => d.filename === filename ? { ...d, indexed: true, status: 'indexed' as const } : d)
        );
        showToast(`✓ Re-indexed "${filename}" successfully`);
        await refreshVault();
      } else {
        throw new Error("Reindex operation returned unsuccessful");
      }
    } catch (e: any) {
      console.error("Reindex error:", e);
      // Rollback
      if (previousDoc) {
        setDocuments(prev => 
          prev.map(d => d.filename === filename ? previousDoc : d)
        );
      }
      showToast(`✗ Failed to re-index "${filename}": ${e?.message || "Unknown error"}`);
    }
  };

  const enhanceDocument = async (filename: string, options?: { extractGraph?: boolean; generateSummary?: boolean }) => {
    const previousDoc = documents.find(d => d.filename === filename);

    // Optimistically set document status to indexing/enhancing
    setDocuments(prev => 
      prev.map(d => d.filename === filename ? { ...d, status: 'indexing' as const } : d)
    );

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
        setDocuments(prev => 
          prev.map(d => d.filename === filename ? { ...d, status: 'indexed' as const, indexed: true } : d)
        );
        showToast(`✓ Enhanced "${filename}" successfully (${res.processing_time}s)`);
        await refreshVault();
      } else {
        throw new Error("Enhancement operation returned unsuccessful");
      }
    } catch (e: any) {
      console.error("Enhancement error:", e);
      if (previousDoc) {
        setDocuments(prev => 
          prev.map(d => d.filename === filename ? previousDoc : d)
        );
      }
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
    
    // Snapshot for rollback
    const previousDocs = documents;
    const previousStats = stats;
    const targets = new Set(filenames);

    // Optimistically remove all targeted documents from UI and cache immediately!
    const nextDocs = documents.filter(d => !targets.has(d.filename));
    const nextStats = {
      ...stats,
      files_count: Math.max(0, stats.files_count - filenames.length),
      files: stats.files.filter(f => !targets.has(f)),
    };
    setDocuments(nextDocs);
    setStats(nextStats);
    try {
      localStorage.setItem('omni_documents_cache', JSON.stringify(nextDocs));
      localStorage.setItem('omni_stats_cache', JSON.stringify(nextStats));
    } catch {}
    showToast(`Deleting ${filenames.length} document(s)...`);

    try {
      let res;
      try {
        res = await api.batchDeleteDocuments(filenames);
      } catch (batchErr) {
        console.warn("Batch delete endpoint fallback to individual calls:", batchErr);
        const settled = await Promise.allSettled(filenames.map(fn => api.deleteDocument(fn)));
        const anyFailed = settled.some(s => s.status === 'rejected');
        if (anyFailed) throw new Error("Some documents failed to delete");
        res = { success: true, deleted: filenames };
      }

      if (res && res.success) {
        showToast(`✓ Successfully deleted ${filenames.length} document(s)`);
        await refreshVault();
      } else {
        throw new Error("Batch delete returned unsuccessful");
      }
    } catch (e: any) {
      console.error("Batch delete error:", e);
      // Full rollback on failure
      setDocuments(previousDocs);
      setStats(previousStats);
      try {
        localStorage.setItem('omni_documents_cache', JSON.stringify(previousDocs));
        localStorage.setItem('omni_stats_cache', JSON.stringify(previousStats));
      } catch {}
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

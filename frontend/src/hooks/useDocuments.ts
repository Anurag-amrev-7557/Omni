import { useState, useEffect, useCallback } from 'react';
import { DocumentItem, CollectionStats, PipelineHealth, UploadProgress } from '../types/document';
import { api } from '../services/api';

const round = (num: number, decimals: number = 2) => {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

export const useDocuments = (showToast: (msg: string) => void) => {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [stats, setStats] = useState<CollectionStats>({
    total_chunks: 0,
    files_count: 0,
    files: []
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [health, setHealth] = useState<PipelineHealth | null>(null);
  const [currentUploadId, setCurrentUploadId] = useState<string | null>(null);

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

  const fetchHealth = useCallback(async () => {
    try {
      setHealth(await api.getHealth());
    } catch (error) {
      console.error("Error fetching pipeline health:", error);
      setHealth(null);
    }
  }, []);

  const refreshVault = useCallback(async () => {
    await Promise.all([
      fetchDocuments(),
      fetchStats(),
      fetchHealth(),
    ]);
  }, [fetchDocuments, fetchHealth, fetchStats]);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  useEffect(() => {
    const timer = window.setInterval(fetchHealth, 30_000);
    return () => window.clearInterval(timer);
  }, [fetchHealth]);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    
    try {
      showToast(`Ingesting ${files.length} file(s) into vector vault...`);
      const res = await api.uploadDocuments(files);
      
      if (res.success && res.upload_id) {
        setCurrentUploadId(res.upload_id);
        
        // Add temporary entries with progress status
        const tempDocs: DocumentItem[] = Array.from(files).map(file => ({
          filename: file.name,
          size_mb: round(file.size / (1024 * 1024), 2),
          pages: 1,
          indexed: false,
          status: 'uploading',
          progress: 0
        }));
        
        setDocuments(prev => [...tempDocs, ...prev]);
        
        // Poll for progress updates
        const pollProgress = setInterval(async () => {
          try {
            const progress = await api.getUploadProgress(res.upload_id!);
            
            // Update documents with progress
            setDocuments(prev => prev.map(doc => {
              const fileProgress = progress.files.find(f => f.filename === doc.filename);
              if (fileProgress) {
                return {
                  ...doc,
                  status: fileProgress.status,
                  progress: fileProgress.progress,
                  indexed: fileProgress.indexed,
                  error: fileProgress.error
                };
              }
              return doc;
            }));
            
            // Stop polling when upload is complete
            if (progress.status === 'completed') {
              clearInterval(pollProgress);
              setCurrentUploadId(null);
              showToast(`Successfully indexed ${res.ingested_count} document(s)`);
              await refreshVault();
            }
          } catch (e) {
            console.error("Progress polling error:", e);
            clearInterval(pollProgress);
          }
        }, 1000); // Poll every second
        
        // Cleanup polling after 5 minutes max
        setTimeout(() => {
          clearInterval(pollProgress);
          setCurrentUploadId(null);
        }, 5 * 60 * 1000);
        
      } else {
        showToast("Upload completed with warnings");
        await refreshVault();
      }
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
    health,
    isLoading,
    isUploading,
    fetchDocuments,
    fetchStats,
    fetchHealth,
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

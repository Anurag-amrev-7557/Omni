import { useState, useEffect, useCallback, useRef } from 'react';
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
  const pollerRef = useRef<number | null>(null);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);

  const fetchDocuments = useCallback(async () => {
    const wakeTimer = window.setTimeout(() => {
      showToast("Waking up the free-tier server... This first request may take up to 45 seconds.");
    }, 3000);
    try {
      setIsLoading(true);
      const docs = await api.getDocuments();
      setDocuments(prev => {
        const serverMap = new Map(docs.map(d => [d.filename, d]));
        // Keep in-flight local uploads only if they haven't appeared on the server yet
        const inFlight = prev.filter(d => !d.indexed && (d.status === 'uploading' || d.status === 'processing') && !serverMap.has(d.filename));
        return [...inFlight, ...docs];
      });
    } catch (e) {
      console.error("Error fetching documents:", e);
    } finally {
      window.clearTimeout(wakeTimer);
      setIsLoading(false);
    }
  }, [showToast]);

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
    const timer = window.setInterval(fetchHealth, 60_000);
    return () => {
      window.clearInterval(timer);
      if (pollerRef.current) {
        window.clearInterval(pollerRef.current);
      }
    };
  }, [fetchHealth]);

  const cancelUpload = useCallback(async (uploadIdToCancel?: string, filenameToCancel?: string) => {
    // 1. Abort in-flight network transfer
    if (activeXhrRef.current) {
      try {
        activeXhrRef.current.abort();
      } catch (err) {
        console.warn("Error aborting XHR:", err);
      }
      activeXhrRef.current = null;
    }

    // 2. Clear background poller
    if (pollerRef.current) {
      window.clearInterval(pollerRef.current);
      pollerRef.current = null;
    }

    setIsUploading(false);
    const targetUploadId = uploadIdToCancel || currentUploadId;

    // 3. Instantly remove from local documents list (0ms optimistic rollback)
    setDocuments(prev => prev.filter(doc => {
      if (filenameToCancel && doc.filename === filenameToCancel) return false;
      if (!filenameToCancel && (doc.status === 'uploading' || doc.status === 'processing')) return false;
      return true;
    }));

    showToast("Upload cancelled and rolled back");

    // 4. Fire backend cancellation & rollback
    if (targetUploadId) {
      try {
        await api.cancelUpload(targetUploadId);
      } catch (e) {
        console.warn("Backend cancel error:", e);
      }
    } else if (filenameToCancel) {
      try {
        await api.deleteDocument(filenameToCancel);
      } catch (e) {
        console.warn("Backend purge error:", e);
      }
    }

    setCurrentUploadId(null);
    await refreshVault();
  }, [currentUploadId, refreshVault, showToast]);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    
    // Clear any active poller
    if (pollerRef.current) {
      window.clearInterval(pollerRef.current);
      pollerRef.current = null;
    }

    const fileList = Array.from(files);
    // 1. Immediately inject progress placeholder items into state so progress bars render instantly
    const tempDocs: DocumentItem[] = fileList.map(file => ({
      filename: file.name,
      size_mb: round(file.size / (1024 * 1024), 2),
      pages: 1,
      indexed: false,
      status: 'uploading',
      progress: 0,
      stage: 'Uploading to server (0%)...'
    }));
    
    setDocuments(prev => {
      const filtered = prev.filter(d => !fileList.some(f => f.name === d.filename));
      return [...tempDocs, ...filtered];
    });

    try {
      const res = await api.uploadDocuments(
        files, 
        (networkPercent) => {
          // Map network upload (0-100%) to initial pipeline stage (0-15%)
          const mappedProgress = Math.min(15, Math.max(1, Math.round((networkPercent / 100) * 15)));
          setDocuments(prev => prev.map(doc => {
            if (fileList.some(f => f.name === doc.filename)) {
              return {
                ...doc,
                status: 'uploading',
                progress: Math.max(doc.progress || 0, mappedProgress),
                stage: mappedProgress >= 15 ? 'Parsing & analyzing document...' : `Transferring to server (${networkPercent}%)...`
              };
            }
            return doc;
          }));
        },
        (xhr) => {
          activeXhrRef.current = xhr;
        }
      );
      
      activeXhrRef.current = null;
      
      if (res.success && res.upload_id) {
        setCurrentUploadId(res.upload_id);
        
        // Attach upload_id to local document items
        setDocuments(prev => prev.map(doc => {
          if (fileList.some(f => f.name === doc.filename)) {
            return {
              ...doc,
              upload_id: res.upload_id,
              progress: Math.max(doc.progress || 0, 15),
              stage: 'Parsing document blocks...'
            };
          }
          return doc;
        }));
        
        // 2. Poll server for background vector ingestion progress sequentially
        const pollInterval = 500;
        const maxPolls = 150;
        let pollCount = 0;
        let isPollingActive = true;

        const pollTick = async () => {
          if (!isPollingActive) return;
          pollCount++;

          try {
            const progress = await api.getUploadProgress(res.upload_id!);
            if (!isPollingActive) return;

            if (progress && progress.status === 'cancelled') {
              isPollingActive = false;
              if (pollerRef.current) {
                window.clearTimeout(pollerRef.current);
                pollerRef.current = null;
              }
              setIsUploading(false);
              setCurrentUploadId(null);
              await refreshVault();
              return;
            }

            if (progress && progress.files && progress.files.length > 0) {
              setDocuments(prev => prev.map(doc => {
                const fProgress = progress.files.find(f => f.filename === doc.filename);
                if (fProgress) {
                  const backendPct = fProgress.progress ?? (fProgress.status === 'completed' ? 100 : 20);
                  const monotonicProgress = Math.max(doc.progress || 0, backendPct);
                  return {
                    ...doc,
                    upload_id: res.upload_id,
                    status: fProgress.status,
                    progress: monotonicProgress,
                    stage: (fProgress as any).stage || (fProgress.status === 'completed' ? 'Completed' : 'Processing document...'),
                    indexed: fProgress.indexed ?? (fProgress.status === 'completed'),
                    error: fProgress.error
                  };
                }
                return doc;
              }));
            }

            const allDone = progress && (
              progress.status === 'completed' || 
              (progress.files && progress.files.length > 0 && progress.files.every(f => f.status === 'completed' || f.status === 'failed' || f.indexed))
            );

            if (allDone || pollCount >= maxPolls) {
              isPollingActive = false;
              if (pollerRef.current) {
                window.clearTimeout(pollerRef.current);
                pollerRef.current = null;
              }
              
              // Mark finished documents in local state immediately
              setDocuments(prev => prev.map(doc => {
                if (fileList.some(f => f.name === doc.filename)) {
                  return {
                    ...doc,
                    status: 'completed',
                    progress: 100,
                    stage: 'Completed',
                    indexed: true
                  };
                }
                return doc;
              }));

              setCurrentUploadId(null);
              setIsUploading(false);

              await refreshVault();
              showToast(`Indexed ${fileList.length} document(s) successfully`);
              return;
            }

            // Schedule next tick ONLY after current tick finishes
            if (isPollingActive) {
              pollerRef.current = window.setTimeout(pollTick, pollInterval);
            }
          } catch (err) {
            console.error("Progress polling error:", err);
            if (pollCount >= 10) {
              isPollingActive = false;
              if (pollerRef.current) {
                window.clearTimeout(pollerRef.current);
                pollerRef.current = null;
              }
              setIsUploading(false);
              setCurrentUploadId(null);
              await refreshVault();
            } else if (isPollingActive) {
              pollerRef.current = window.setTimeout(pollTick, pollInterval);
            }
          }
        };

        // Start initial poll tick
        pollerRef.current = window.setTimeout(pollTick, pollInterval);

      } else {
        setIsUploading(false);
        await refreshVault();
      }
    } catch (e: any) {
      activeXhrRef.current = null;
      if (e?.message === 'Upload aborted by user') {
        return; // Handled cleanly by cancelUpload
      }
      console.error("Upload error:", e);
      setDocuments(prev => prev.map(doc => {
        if (fileList.some(f => f.name === doc.filename)) {
          return {
            ...doc,
            status: 'failed',
            progress: 100,
            error: e?.message || "Upload failed"
          };
        }
        return doc;
      }));
      showToast("Error ingesting documents");
      setIsUploading(false);
    }
  };

  const deleteDocument = async (filename: string) => {
    if (!window.confirm(`Delete "${filename}" and its vector embeddings from Qdrant?`)) return;
    
    // Optimistic UI removal
    setDocuments(prev => prev.filter(d => d.filename !== filename));
    setStats(prev => ({
      ...prev,
      files_count: Math.max(0, prev.files_count - 1),
      files: prev.files.filter(f => f !== filename)
    }));
    
    try {
      const res = await api.deleteDocument(filename);
      if (res.success) {
        showToast(`Removed "${filename}" from vault`);
      }
    } catch (e) {
      console.error("Delete error:", e);
      showToast("Failed to delete document");
    } finally {
      await refreshVault();
    }
  };

  const reindexDocument = async (filename: string) => {
    // Optimistic state transition
    setDocuments(prev => prev.map(d => d.filename === filename ? { ...d, status: 'processing', progress: 50, indexed: false } : d));
    try {
      showToast(`Re-indexing "${filename}"...`);
      const res = await api.reindexDocument(filename);
      if (res.success) {
        setDocuments(prev => prev.map(d => d.filename === filename ? { ...d, status: 'completed', progress: 100, indexed: true } : d));
        showToast(`Re-indexed "${filename}" successfully`);
      }
    } catch (e) {
      console.error("Reindex error:", e);
      showToast("Failed to re-index document");
    } finally {
      await refreshVault();
    }
  };

  const downloadDocument = async (filename: string) => {
    try {
      await api.downloadFile(filename);
      showToast(`Downloaded "${filename}"`);
    } catch (e) {
      console.error("Download error:", e);
      showToast("Failed to download file");
    }
  };

  // Mass / Batch Operations with Optimistic UI Updates
  const batchDeleteDocuments = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    if (!window.confirm(`Delete ${filenames.length} selected document(s) and their vector embeddings from Qdrant?`)) return;
    
    // Optimistic batch removal
    setDocuments(prev => prev.filter(d => !filenames.includes(d.filename)));
    setStats(prev => ({
      ...prev,
      files_count: Math.max(0, prev.files_count - filenames.length),
      files: prev.files.filter(f => !filenames.includes(f))
    }));

    try {
      showToast(`Deleting ${filenames.length} document(s)...`);
      await Promise.all(filenames.map(fn => api.deleteDocument(fn)));
      showToast(`Successfully deleted ${filenames.length} document(s)`);
    } catch (e) {
      console.error("Batch delete error:", e);
      showToast("Failed to delete some documents");
    } finally {
      await refreshVault();
    }
  };

  const batchReindexDocuments = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    setDocuments(prev => prev.map(d => filenames.includes(d.filename) ? { ...d, status: 'processing', progress: 50, indexed: false } : d));
    try {
      showToast(`Re-indexing ${filenames.length} document(s)...`);
      await Promise.all(filenames.map(fn => api.reindexDocument(fn)));
      showToast(`Successfully re-indexed ${filenames.length} document(s)`);
    } catch (e) {
      console.error("Batch reindex error:", e);
      showToast("Failed to reindex some documents");
    } finally {
      await refreshVault();
    }
  };

  const batchDownloadDocuments = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    for (const fn of filenames) {
      await downloadDocument(fn);
    }
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
    currentUploadId,
    fetchDocuments,
    fetchStats,
    fetchHealth,
    refreshVault,
    uploadFiles,
    cancelUpload,
    deleteDocument,
    reindexDocument,
    downloadDocument,
    batchDeleteDocuments,
    batchReindexDocuments,
    batchDownloadDocuments,
    cleanupOrphaned,
  };
};

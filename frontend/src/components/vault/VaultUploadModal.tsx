import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, X, Layers, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { FormatBadge } from '../common/FormatBadge';
import { DocumentItem } from '../../types/document';
import { api } from '../../services/api';

interface VaultUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess?: () => void;
  onAddDocument?: (doc: DocumentItem) => void;
  showToast: (msg: string) => void;
  initialFiles?: File[] | null;
}

type FileStatus = 'queued' | 'uploading' | 'completed' | 'failed';

interface FileUploadState {
  file: File;
  status: FileStatus;
  error?: string;
  progress?: number;
  stageMessage?: string;
  retryCount: number;
}

export const VaultUploadModal: React.FC<VaultUploadModalProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
  onAddDocument,
  showToast,
  initialFiles,
}) => {
  const [fileStates, setFileStates] = useState<FileUploadState[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const MAX_RETRIES = 2;

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setFileStates(prev => {
        const existing = new Set(prev.map(f => `${f.file.name}_${f.file.size}`));
        const newStates: FileUploadState[] = initialFiles
          .filter(f => !existing.has(`${f.name}_${f.size}`))
          .map(file => ({
            file,
            status: 'queued' as FileStatus,
            retryCount: 0,
          }));
        return [...prev, ...newStates];
      });
    }
  }, [initialFiles]);

  if (!isOpen) return null;

  const handleFilesChosen = (files: FileList | null) => {
    if (!files || isUploading) return;
    const newFiles = Array.from(files);
    setFileStates(prev => {
      const existing = new Set(prev.map(f => `${f.file.name}_${f.file.size}`));
      const newStates: FileUploadState[] = newFiles
        .filter(f => !existing.has(`${f.name}_${f.size}`))
        .map(file => ({
          file,
          status: 'queued' as FileStatus,
          retryCount: 0,
        }));
      return [...prev, ...newStates];
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && !isUploading) {
      handleFilesChosen(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    if (isUploading) return;
    setFileStates(prev => prev.filter((_, i) => i !== index));
  };

  const resetModal = () => {
    setFileStates([]);
    setIsUploading(false);
    setCurrentFileIndex(0);
  };

  const handleClose = () => {
    if (isUploading) {
      if (!window.confirm('Upload in progress. Are you sure you want to cancel?')) {
        return;
      }
    }
    resetModal();
    onClose();
  };

  const uploadSingleFile = async (fileState: FileUploadState, index: number): Promise<boolean> => {
    const { file } = fileState;
    
    // Start with uploading status and initial state
    setFileStates(prev => {
      const next = [...prev];
      next[index] = { ...next[index], status: 'uploading', progress: 5, stageMessage: 'Uploading...' };
      return next;
    });

    // Optimistically insert document into the table immediately with indexing status
    const sizeMb = parseFloat((file.size / (1024 * 1024)).toFixed(2));
    onAddDocument?.({
      filename: file.name,
      size_mb: sizeMb,
      pages: 1,
      indexed: false,
      status: 'indexing',
    });

    try {
      // Connect to backend stream for real stage-by-stage progress (extraction, chunking, embeddings, indexing)
      await api.uploadSingleDocumentStream(file, (event) => {
        if (event.type === 'progress') {
          setFileStates(prev => {
            const next = [...prev];
            if (!next[index]) return prev;
            next[index] = {
              ...next[index],
              progress: event.progress ?? next[index].progress ?? 10,
              stageMessage: event.message || 'Processing...',
            };
            return next;
          });
        }
      });

      // Complete the progress to 100%
      setFileStates(prev => {
        const next = [...prev];
        next[index] = { ...next[index], progress: 100, stageMessage: 'Indexed' };
        return next;
      });

      // Mark as completed
      setFileStates(prev => {
        const next = [...prev];
        next[index] = { ...next[index], status: 'completed', progress: 100, stageMessage: 'Indexed' };
        return next;
      });

      // Optimistically insert document into the table
      const sizeMb = parseFloat((file.size / (1024 * 1024)).toFixed(2));
      onAddDocument?.({
        filename: file.name,
        size_mb: sizeMb,
        pages: 1,
        indexed: true,
      });

      return true;
    } catch (err: any) {
      const errorMsg = err.message || 'Ingestion failed';
      setFileStates(prev => {
        const next = [...prev];
        next[index] = { 
          ...next[index], 
          status: 'failed', 
          error: errorMsg,
          stageMessage: 'Failed',
          progress: 0,
        };
        return next;
      });
      return false;
    }
  };

  const retryFailedFile = async (index: number) => {
    const fileState = fileStates[index];
    if (fileState.retryCount >= MAX_RETRIES) {
      showToast(`Max retries reached for ${fileState.file.name}`);
      return;
    }

    setFileStates(prev => {
      const next = [...prev];
      next[index] = { 
        ...next[index], 
        status: 'queued',
        error: undefined,
        retryCount: next[index].retryCount + 1,
      };
      return next;
    });

    await uploadSingleFile(fileState, index);
  };

  const handleStartUpload = async () => {
    if (fileStates.length === 0 || isUploading) return;

    setIsUploading(true);
    setCurrentFileIndex(0);

    const CONCURRENCY = 2;
    const queue = fileStates
      .map((fs, idx) => ({ fs, idx }))
      .filter(({ fs }) => fs.status !== 'completed');

    let completedCount = fileStates.filter(s => s.status === 'completed').length;
    let failedCount = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        setCurrentFileIndex(item.idx);
        const success = await uploadSingleFile(item.fs, item.idx);
        if (success) completedCount++;
        else failedCount++;
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      () => worker()
    );
    await Promise.all(workers);

    setIsUploading(false);
    
    // Refresh the vault to ensure sync
    try {
      await onUploadSuccess?.();
    } catch (error) {
      console.error("Error refreshing vault after upload:", error);
    }

    if (failedCount === 0) {
      showToast(`✓ Successfully indexed ${completedCount} document(s)`);
      // Brief delay so users can see the completed state
      setTimeout(() => {
        handleClose();
      }, 1200);
    } else {
      showToast(`⚠ Indexed ${completedCount} file(s), ${failedCount} failed (click retry)`);
    }
  };

  const totalSizeMb = fileStates.reduce((acc, f) => acc + f.file.size / (1024 * 1024), 0).toFixed(2);
  const completedCount = fileStates.filter(s => s.status === 'completed').length;
  const failedCount = fileStates.filter(s => s.status === 'failed').length;
  const totalProgressUnits = fileStates.reduce((acc, f) => {
    if (f.status === 'completed') return acc + 100;
    if (f.status === 'uploading') return acc + (f.progress || 0);
    return acc;
  }, 0);
  const progressPercent = fileStates.length > 0 
    ? Math.round(totalProgressUnits / fileStates.length) 
    : 0;
  const canRetry = failedCount > 0 && !isUploading;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm fade-in select-none"
      style={{ backgroundColor: 'var(--backdrop-color)' }}
      onClick={handleClose}
    >
      <div 
        className="w-full max-w-lg rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-2xl p-6 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--text-main)] tracking-tight">
              {isUploading ? 'Ingesting Documents...' : 'Add Documents to Vault'}
            </h2>
            <p className="text-[12.5px] text-[var(--text-muted)] mt-0.5">
              {isUploading 
                ? `Indexing file ${currentFileIndex + 1} of ${fileStates.length} into Qdrant vector memory`
                : 'Upload research PDFs, Markdown specifications, or code files'}
            </p>
          </div>
          {!isUploading && (
            <button 
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              onClick={handleClose}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto py-4 space-y-4 flex-1">
          {/* Live Progress Bar when Uploading */}
          {isUploading && (
            <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2">
              <div className="flex items-center justify-between text-[12px] font-medium text-[var(--text-main)]">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin text-[var(--accent-primary)]" />
                  <span>Processing: {fileStates[currentFileIndex]?.file.name}</span>
                </span>
                <span className="font-mono text-[var(--accent-primary)]">{progressPercent}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--bg-input)] overflow-hidden">
                <div 
                  className="h-full bg-[var(--accent-primary)] transition-all duration-300 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Drop Area (hidden during upload) */}
          {!isUploading && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border border-dashed rounded-xl p-7 text-center cursor-pointer transition-all ${
                isDragOver
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)] scale-[0.99]'
                  : 'border-[var(--border-color)] bg-[var(--bg-input)]/40 hover:border-[var(--accent-primary)] hover:bg-[var(--bg-input)]/70'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.md,.txt,.docx,.py,.ts,.tsx,.js,.jsx,.json,.yaml,.yml"
                onChange={(e) => handleFilesChosen(e.target.files)}
                className="hidden"
              />
              <div className="w-10 h-10 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--accent-primary)] mx-auto flex items-center justify-center mb-3 shadow-2xs">
                <UploadCloud size={20} />
              </div>
              <div className="text-[13.5px] font-medium text-[var(--text-main)] mb-1">
                Drag and drop files here, or <span className="text-[var(--accent-primary)] font-semibold underline underline-offset-2">browse</span>
              </div>
              <div className="text-[12px] text-[var(--text-muted)]">
                PDF, Markdown, Source Code (.ts, .py), or Text up to 50MB each
              </div>
            </div>
          )}

          {/* Queued / Ingesting Files List */}
          {fileStates.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[12.5px] font-semibold text-[var(--text-main)] px-0.5">
                <span>Documents ({fileStates.length})</span>
                <span className="font-mono text-[11.5px] text-[var(--text-muted)]">
                  {isUploading 
                    ? `${completedCount}/${fileStates.length} indexed` 
                    : `${totalSizeMb} MB total`}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {fileStates.map((fileState, idx) => {
                  const { file, status, error, progress = 0 } = fileState;

                  return (
                    <div
                      key={`${file.name}_${idx}`}
                      className="flex flex-col p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-xs shadow-2xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5 min-w-0 pr-2 flex-1">
                          <FormatBadge filename={file.name} size="xs" />
                          <span className="font-medium text-[13px] text-[var(--text-main)] truncate max-w-xs">{file.name}</span>
                          <span className="font-mono text-[11px] text-[var(--text-muted)] flex-shrink-0">
                            {(file.size / (1024 * 1024)).toFixed(2)} MB
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {status === 'uploading' && (
                            <div className="flex items-center gap-1.5 text-[11px] text-[var(--accent-primary)] font-medium">
                              <Loader2 size={12} className="animate-spin" />
                              <span className="text-[11px] font-normal text-[var(--text-muted)] max-w-[150px] truncate hidden sm:inline">
                                {fileState.stageMessage || 'Processing...'}
                              </span>
                              <span>{progress}%</span>
                            </div>
                          )}
                          {status === 'completed' && (
                            <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                              <CheckCircle2 size={13} />
                              <span>Indexed</span>
                            </div>
                          )}
                          {status === 'failed' && (
                            <>
                              <div className="flex items-center gap-1 text-[11px] text-red-400 font-medium" title={error}>
                                <AlertCircle size={13} />
                                <span>Failed</span>
                              </div>
                              {!isUploading && fileState.retryCount < MAX_RETRIES && (
                                <button
                                  type="button"
                                  className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] transition-colors flex-shrink-0 cursor-pointer"
                                  onClick={() => retryFailedFile(idx)}
                                  title="Retry upload"
                                >
                                  <RefreshCw size={13} />
                                </button>
                              )}
                            </>
                          )}
                          {!isUploading && status === 'queued' && (
                            <button
                              type="button"
                              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--bg-hover)] transition-colors flex-shrink-0 cursor-pointer"
                              onClick={() => handleRemoveFile(idx)}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {/* Individual File Progress Bar */}
                      {status === 'uploading' && (
                        <div className="mt-2 w-full h-1.5 rounded-full bg-[var(--bg-input)] overflow-hidden">
                          <div 
                            className="h-full bg-[var(--accent-primary)] transition-all duration-300 rounded-full"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Clean Vector Ingestion Note */}
          <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-muted)] px-1">
            <Layers size={13} className="text-[var(--accent-primary)] flex-shrink-0" />
            <span>Files are chunked and indexed into Qdrant vector memory. New entries appear instantly.</span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3.5 border-t border-[var(--border-color)]">
          <div className="text-[12px] text-[var(--text-muted)]">
            {fileStates.length > 0 
              ? `${fileStates.length} file(s) selected ${failedCount > 0 ? `• ${failedCount} failed` : ''}` 
              : 'No files selected'}
          </div>
          <div className="flex items-center gap-2">
            {!isUploading && (
              <button
                type="button"
                className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                onClick={handleClose}
              >
                {completedCount > 0 && failedCount === 0 ? 'Done' : 'Cancel'}
              </button>
            )}
            {canRetry && (
              <button
                type="button"
                className="h-9 px-4 rounded-lg bg-orange-500 text-white text-[13px] font-medium hover:opacity-90 active:scale-[0.98] shadow-xs cursor-pointer transition-all inline-flex items-center gap-2"
                onClick={handleStartUpload}
              >
                <RefreshCw size={14} />
                <span>Retry Failed ({failedCount})</span>
              </button>
            )}
            {!canRetry && (
              <button
                type="button"
                disabled={fileStates.length === 0 || isUploading}
                className="h-9 px-4 rounded-lg bg-[var(--accent-primary)] text-[var(--accent-contrast-text)] text-[13px] font-medium hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer transition-all inline-flex items-center gap-2"
                onClick={handleStartUpload}
              >
                {isUploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Indexing {currentFileIndex + 1}/{fileStates.length}...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={14} />
                    <span>Upload & Ingest ({fileStates.length})</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

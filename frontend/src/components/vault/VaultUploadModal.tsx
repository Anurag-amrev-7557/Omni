import React, { useState, useRef } from 'react';
import { UploadCloud, X, Layers, FileText } from 'lucide-react';
import { FormatBadge } from '../common/FormatBadge';

interface VaultUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (files: FileList | File[]) => void;
  isUploading: boolean;
  showToast: (msg: string) => void;
}

export const VaultUploadModal: React.FC<VaultUploadModalProps> = ({
  isOpen,
  onClose,
  onUpload,
  isUploading,
  showToast,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const ALLOWED_EXTS = ['.pdf', '.md', '.txt'];
  const MAX_SIZE_BYTES = 35 * 1024 * 1024; // 35 MB

  const handleFilesChosen = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files);
    const valid: File[] = [];

    for (const file of incoming) {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        showToast(`"${file.name}" is not supported. Use PDF, Markdown, or Text.`);
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        showToast(`"${file.name}" exceeds maximum allowed size of 35 MB.`);
        continue;
      }
      valid.push(file);
    }

    if (valid.length === 0) return;

    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => `${f.name}_${f.size}`));
      const unique = valid.filter(f => !existing.has(`${f.name}_${f.size}`));
      if (prev.length + unique.length > 10) {
        showToast("Maximum 10 files allowed per upload batch.");
        return [...prev, ...unique].slice(0, 10);
      }
      return [...prev, ...unique];
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      handleFilesChosen(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (selectedFiles.length === 0) {
      showToast('Please select at least one document to upload');
      return;
    }
    onUpload(selectedFiles);
    setSelectedFiles([]);
    onClose();
  };

  const totalSizeMb = selectedFiles.reduce((acc, f) => acc + f.size / (1024 * 1024), 0).toFixed(2);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm fade-in select-none"
      style={{ backgroundColor: 'var(--backdrop-color)' }}
      onClick={onClose}
    >
      <div 
        className="w-full max-w-lg rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-2xl p-6 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--text-main)] tracking-tight">
              Add Documents to Vault
            </h2>
            <p className="text-[12.5px] text-[var(--text-muted)] mt-0.5">
              Upload research PDFs, Markdown specifications, or plain text notes
            </p>
          </div>
          <button 
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto py-4 space-y-4 flex-1">
          {/* Drop Area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              isDragOver
                ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)] scale-[0.99]'
                : 'border-[var(--border-color)] bg-[var(--bg-input)]/40 hover:border-[var(--accent-primary)] hover:bg-[var(--bg-input)]/70'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.md,.txt"
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
              PDF, Markdown (.md), or Text (.txt) up to 35MB each (Max 10 files)
            </div>
          </div>

          {/* Queued Files List */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[12.5px] font-semibold text-[var(--text-main)] px-0.5">
                <span>Selected Files ({selectedFiles.length})</span>
                <span className="font-mono text-[11.5px] text-[var(--text-muted)]">{totalSizeMb} MB total</span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {selectedFiles.map((file, idx) => (
                  <div
                    key={`${file.name}_${idx}`}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-xs shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <FormatBadge filename={file.name} size="xs" />
                      <span className="font-medium text-[13px] text-[var(--text-main)] truncate max-w-xs">{file.name}</span>
                      <span className="font-mono text-[11px] text-[var(--text-muted)] flex-shrink-0">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>
                    <button
                      type="button"
                      className="p-1 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--bg-hover)] transition-colors flex-shrink-0 cursor-pointer"
                      onClick={() => handleRemoveFile(idx)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clean Vector Ingestion Note */}
          <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-muted)] px-1">
            <Layers size={13} className="text-[var(--accent-primary)] flex-shrink-0" />
            <span>Files will be automatically chunked and indexed into Qdrant vector memory.</span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3.5 border-t border-[var(--border-color)]">
          <div className="text-[12px] text-[var(--text-muted)]">
            {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) ready` : 'No files selected'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedFiles.length === 0 || isUploading}
              className="h-9 px-4 rounded-lg bg-[var(--accent-primary)] text-white text-[13px] font-medium hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer transition-all inline-flex items-center gap-2"
              onClick={handleSubmit}
            >
              <UploadCloud size={14} />
              <span>{isUploading ? 'Ingesting...' : selectedFiles.length > 0 ? `Upload & Ingest (${selectedFiles.length})` : 'Upload & Ingest'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

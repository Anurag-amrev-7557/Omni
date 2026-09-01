import React from 'react';
import { CheckCircle2, RotateCw, Download, Trash2, X, FileCheck } from 'lucide-react';
import { DocumentItem } from '../../types/document';

interface VaultMassActionsBarProps {
  selectedFilenames: string[];
  documents: DocumentItem[];
  onClearSelection: () => void;
  onBatchReindex: (filenames: string[]) => void;
  onBatchDownload: (filenames: string[]) => void;
  onBatchDelete: (filenames: string[]) => void;
}

export const VaultMassActionsBar: React.FC<VaultMassActionsBarProps> = ({
  selectedFilenames,
  documents,
  onClearSelection,
  onBatchReindex,
  onBatchDownload,
  onBatchDelete,
}) => {
  if (selectedFilenames.length === 0) return null;

  const selectedDocs = documents.filter(d => selectedFilenames.includes(d.filename));
  const totalMb = selectedDocs.reduce((acc, d) => acc + (d.size_mb || 0), 0).toFixed(2);

  return (
    <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-40 fade-in select-none max-w-[94vw]">
      <div className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-xs overflow-x-auto">
        
        {/* Count & Info */}
        <div className="flex items-center gap-2 pr-3 border-r border-[var(--border-color)]">
          <div className="w-5 h-5 rounded-full bg-[var(--accent-primary)] text-white flex items-center justify-center font-bold text-[10px]">
            {selectedFilenames.length}
          </div>
          <div className="font-medium text-[var(--text-main)]">
            <span>{selectedFilenames.length} selected</span>
            <span className="font-mono text-[10.5px] text-[var(--text-muted)] ml-1.5">({totalMb} MB)</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-colors cursor-pointer font-medium"
            onClick={() => onBatchReindex(selectedFilenames)}
            title="Re-index selected documents"
          >
            <RotateCw size={13} className="text-[var(--accent-primary)]" />
            <span>Re-index</span>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-colors cursor-pointer font-medium"
            onClick={() => onBatchDownload(selectedFilenames)}
            title="Download selected documents"
          >
            <Download size={13} />
            <span>Download</span>
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors cursor-pointer font-medium"
            onClick={() => onBatchDelete(selectedFilenames)}
            title="Delete selected documents from vault"
          >
            <Trash2 size={13} />
            <span>Delete</span>
          </button>
        </div>

        {/* Deselect / Dismiss */}
        <button
          className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors ml-1"
          onClick={onClearSelection}
          title="Clear selection (Esc)"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

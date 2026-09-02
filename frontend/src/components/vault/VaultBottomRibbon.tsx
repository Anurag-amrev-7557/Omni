import React from 'react';
import { HardDrive, Database, Layers, ShieldCheck, RotateCw, Download, Trash2, X, CheckSquare } from 'lucide-react';
import { PipelineHealth, DocumentItem } from '../../types/document';

interface VaultBottomRibbonProps {
  totalFiles: number;
  totalMb: number;
  totalChunks: number;
  health: PipelineHealth | null;
  selectedFilenames?: string[];
  documents?: DocumentItem[];
  onClearSelection?: () => void;
  onBatchReindex?: (filenames: string[]) => void;
  onBatchDownload?: (filenames: string[]) => void;
  onBatchDelete?: (filenames: string[]) => void;
}

export const VaultBottomRibbon: React.FC<VaultBottomRibbonProps> = ({
  totalFiles,
  totalMb,
  totalChunks,
  health,
  selectedFilenames = [],
  documents = [],
  onClearSelection,
  onBatchReindex,
  onBatchDownload,
  onBatchDelete,
}) => {
  const isBatchMode = selectedFilenames.length > 0;
  const selectedDocs = documents.filter(d => selectedFilenames.includes(d.filename));
  const selectedMb = selectedDocs.reduce((acc, d) => acc + (d.size_mb || 0), 0).toFixed(2);

  const qdrantHealthy = Boolean(health?.status === 'healthy' || health?.checks?.qdrant?.status === 'healthy' || (health as any)?.qdrant_connected);
  const healthLabel = !health ? 'Pipeline standby' : qdrantHealthy ? `Qdrant ${health.status || 'healthy'}` : 'Qdrant offline';

  return (
    <footer className="h-12 min-h-[48px] border-t border-[var(--border-color)] bg-[var(--bg-card)] flex items-center justify-between select-none flex-shrink-0 shadow-2xs transition-colors duration-200">
      <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 overflow-hidden">
        {isBatchMode ? (
          /* Transformed In-Place Mass Actions Dock Bar */
          <div className="w-full flex items-center justify-between gap-3 fade-in">
            {/* Left: Count, Size & Clear */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-[var(--accent-subtle)] border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] shadow-2xs">
                <CheckSquare size={13} />
                <span className="text-[12px] font-semibold">
                  {selectedFilenames.length} selected
                </span>
                <span className="text-[11px] font-mono opacity-80">
                  ({selectedMb} MB)
                </span>
              </div>

              <button
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                onClick={onClearSelection}
                title="Deselect all (Esc)"
              >
                <X size={12} />
                <span className="hidden xs:inline text-[11.5px]">Clear</span>
              </button>
            </div>

            {/* Right: Mass Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-all cursor-pointer text-xs font-medium active:scale-95 shadow-2xs"
                onClick={() => onBatchReindex?.(selectedFilenames)}
                title="Re-index selected documents"
              >
                <RotateCw size={12} className="text-[var(--accent-primary)]" />
                <span>Re-index</span>
              </button>

              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-all cursor-pointer text-xs font-medium active:scale-95 shadow-2xs"
                onClick={() => onBatchDownload?.(selectedFilenames)}
                title="Download selected documents"
              >
                <Download size={12} />
                <span className="hidden sm:inline">Download</span>
              </button>

              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all cursor-pointer text-xs font-medium active:scale-95 shadow-2xs"
                onClick={() => onBatchDelete?.(selectedFilenames)}
                title="Delete selected documents from vault"
              >
                <Trash2 size={12} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        ) : (
          /* Default Status & Metrics View */
          <>
            {/* Left: Active Corpus & Size */}
            <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] shadow-2xs flex-shrink-0">
              <HardDrive size={13} className="text-[var(--accent-primary)]" />
              <span className="text-[12px] sm:text-[12.5px] font-semibold text-[var(--text-main)]">
                {totalFiles} <span className="hidden xs:inline">{totalFiles === 1 ? 'Doc' : 'Docs'}</span>
              </span>
              <span className="text-[11px] sm:text-[11.5px] font-mono text-[var(--text-muted)] font-medium">
                ({totalMb.toFixed(1)}M)
              </span>
            </div>

            {/* Middle: Vector Engine & Hybrid Retrieval Specs */}
            <div className="hidden md:flex items-center gap-3 px-3 py-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] shadow-2xs">
              <div className="flex items-center gap-1.5">
                <Database size={14} className="text-blue-500" />
                <span className="text-[12.5px] font-semibold text-[var(--text-main)]">{totalChunks}</span>
                <span className="text-[12px] text-[var(--text-muted)]">Vectors (384d)</span>
              </div>

              <span className="w-1 h-1 rounded-full bg-[var(--text-muted)] opacity-50" />

              <div className="flex items-center gap-1.5">
                <Layers size={14} className="text-emerald-500" />
                <span className="text-[12px] font-medium text-[var(--text-main)]">Hybrid Dense + BM25 RRF</span>
              </div>
            </div>

            {/* Right: Health & Grounding Verification */}
            <div className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3 py-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] shadow-2xs flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${qdrantHealthy ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                <span className="text-[11.5px] sm:text-[12px] font-semibold text-[var(--text-main)]" title={health?.checks?.qdrant?.error}>{healthLabel}</span>
              </div>

              <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-[var(--text-muted)] opacity-50" />

              <div className="hidden sm:flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-purple-500" />
                <span className="text-[12px] font-semibold text-[var(--text-main)]">100% Grounded</span>
              </div>
            </div>
          </>
        )}
      </div>
    </footer>
  );
};

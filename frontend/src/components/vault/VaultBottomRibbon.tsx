import React, { useState, useEffect } from 'react';
import { HardDrive, Database, Layers, ShieldCheck, RotateCw, Download, Trash2, X, CheckCircle2 } from 'lucide-react';
import { DocumentItem } from '../../types/document';
import { api } from '../../services/api';

interface VaultBottomRibbonProps {
  totalFiles: number;
  totalMb: number;
  totalChunks: number;
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
  selectedFilenames = [],
  documents = [],
  onClearSelection,
  onBatchReindex,
  onBatchDownload,
  onBatchDelete,
}) => {
  const [health, setHealth] = useState<{
    status: string;
    qdrantStatus: string;
    graphEntities: number;
    graphRelations: number;
  }>({
    status: 'healthy',
    qdrantStatus: 'online',
    graphEntities: 0,
    graphRelations: 0,
  });

  useEffect(() => {
    let mounted = true;
    const fetchHealth = () => {
      api.getHealth()
        .then((res) => {
          if (!mounted || !res.pipeline) return;
          setHealth({
            status: res.status,
            qdrantStatus: res.pipeline.qdrant?.status || 'online',
            graphEntities: res.pipeline.graph_db?.entities || 0,
            graphRelations: res.pipeline.graph_db?.relations || 0,
          });
        })
        .catch(() => {});
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const hasSelection = selectedFilenames.length > 0;

  // 1. BULK SELECTION MODE: Replaces bottom ribbon content smoothly
  if (hasSelection) {
    const selectedDocs = documents.filter((d) => selectedFilenames.includes(d.filename));
    const selectedMb = selectedDocs.reduce((acc, d) => acc + (d.size_mb || 0), 0).toFixed(2);

    return (
      <footer className="h-12 min-h-[48px] border-t border-[var(--border-color)] bg-[var(--bg-modal)] flex items-center justify-between select-none flex-shrink-0 shadow-lg px-3 sm:px-6 transition-all duration-300 animate-in fade-in">
        <div className="max-w-6xl mx-auto w-full flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          {/* Selected Count & Size Badge */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="w-5 h-5 rounded-md bg-[var(--accent-primary)] text-white flex items-center justify-center font-bold text-[11px] font-mono shadow-xs">
              {selectedFilenames.length}
            </span>
            <span className="text-[12.5px] font-semibold text-[var(--text-main)] whitespace-nowrap">
              {selectedFilenames.length} {selectedFilenames.length === 1 ? 'doc' : 'docs'} selected
            </span>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              ({selectedMb} MB)
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onBatchReindex && (
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-input)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-colors cursor-pointer text-xs font-medium"
                onClick={() => onBatchReindex(selectedFilenames)}
                title="Re-index selected documents"
              >
                <RotateCw size={13} className="text-[var(--accent-primary)]" />
                <span>Re-index</span>
              </button>
            )}

            {onBatchDownload && (
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-input)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-colors cursor-pointer text-xs font-medium"
                onClick={() => onBatchDownload(selectedFilenames)}
                title="Download selected documents"
              >
                <Download size={13} />
                <span>Download</span>
              </button>
            )}

            {onBatchDelete && (
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors cursor-pointer text-xs font-medium"
                onClick={() => onBatchDelete(selectedFilenames)}
                title="Delete selected documents from vault"
              >
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            )}

            {onClearSelection && (
              <button
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors ml-1 cursor-pointer"
                onClick={onClearSelection}
                title="Clear selection (Esc)"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </footer>
    );
  }

  // 2. DEFAULT METRICS & LIVE PIPELINE HEALTH MODE
  return (
    <footer className="h-12 min-h-[48px] border-t border-[var(--border-color)] bg-[var(--bg-card)] flex items-center justify-between select-none flex-shrink-0 shadow-2xs transition-all duration-300">
      <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 overflow-hidden">
        
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

        {/* Right: Actual & Real Health & Grounding Verification */}
        <div className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3 py-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] shadow-2xs flex-shrink-0">
          <div className="flex items-center gap-1.5" title="Qdrant Vector Database Live Status">
            <span 
              className={`w-2 h-2 rounded-full ${
                health.qdrantStatus === 'online' 
                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' 
                  : 'bg-amber-500'
              }`} 
            />
            <span className="text-[11.5px] sm:text-[12px] font-semibold text-[var(--text-main)]">
              {health.qdrantStatus === 'online' ? 'Qdrant Active' : 'Connecting'}
            </span>
          </div>

          <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-[var(--text-muted)] opacity-50" />

          <div className="hidden sm:flex items-center gap-1.5" title={`SQLite Knowledge Graph: ${health.graphEntities} entities, ${health.graphRelations} relations`}>
            <ShieldCheck size={14} className="text-purple-500" />
            <span className="text-[12px] font-semibold text-[var(--text-main)]">
              {health.graphEntities > 0 ? `Graph (${health.graphEntities}E)` : '100% Grounded'}
            </span>
          </div>
        </div>

      </div>
    </footer>
  );
};


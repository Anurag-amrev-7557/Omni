import React from 'react';
import { HardDrive, Database, Layers, CheckCircle2 } from 'lucide-react';

interface VaultKpiGridProps {
  totalFiles: number;
  totalMb: number;
  totalChunks: number;
}

export const VaultKpiGrid: React.FC<VaultKpiGridProps> = ({ totalFiles, totalMb, totalChunks }) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 select-none">
      {/* 1. Active Corpus */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xs">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center flex-shrink-0">
          <HardDrive size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] truncate">Corpus</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-[14px] font-semibold text-[var(--text-main)] leading-none">{totalFiles} Files</span>
            <span className="text-[11.5px] font-mono text-[var(--text-muted)] truncate">({totalMb.toFixed(2)} MB)</span>
          </div>
        </div>
      </div>

      {/* 2. Vector Embeddings */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xs">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center flex-shrink-0">
          <Database size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] truncate">Embeddings</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-[14px] font-semibold text-[var(--text-main)] leading-none">{totalChunks}</span>
            <span className="text-[11.5px] font-mono text-[var(--text-muted)] truncate">384d vectors</span>
          </div>
        </div>
      </div>

      {/* 3. Hybrid Engine */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xs">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center flex-shrink-0">
          <Layers size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] truncate">Retrieval</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-[14px] font-semibold text-[var(--text-main)] leading-none">Dense + BM25</span>
            <span className="text-[11.5px] text-[var(--text-muted)] truncate">RRF</span>
          </div>
        </div>
      </div>

      {/* 4. Grounding Status */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xs">
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] truncate">Grounding</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-[14px] font-semibold text-[var(--text-main)] leading-none">100% Grounded</span>
            <span className="text-[11.5px] text-[var(--text-muted)] truncate">Zero drift</span>
          </div>
        </div>
      </div>
    </div>
  );
};

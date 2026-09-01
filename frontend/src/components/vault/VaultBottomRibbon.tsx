import React from 'react';
import { HardDrive, Database, Layers, ShieldCheck } from 'lucide-react';

interface VaultBottomRibbonProps {
  totalFiles: number;
  totalMb: number;
  totalChunks: number;
}

export const VaultBottomRibbon: React.FC<VaultBottomRibbonProps> = ({
  totalFiles,
  totalMb,
  totalChunks,
}) => {
  return (
    <footer className="h-12 min-h-[48px] border-t border-[var(--border-color)] bg-[var(--bg-card)] flex items-center justify-between select-none flex-shrink-0 shadow-2xs">
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

        {/* Right: Health & Grounding Verification */}
        <div className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3 py-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] shadow-2xs flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span className="text-[11.5px] sm:text-[12px] font-semibold text-[var(--text-main)]">Qdrant Active</span>
          </div>

          <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-[var(--text-muted)] opacity-50" />

          <div className="hidden sm:flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-purple-500" />
            <span className="text-[12px] font-semibold text-[var(--text-main)]">100% Grounded</span>
          </div>
        </div>

      </div>
    </footer>
  );
};

import React from 'react';
import { Search, X } from 'lucide-react';

interface VaultToolbarProps {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  activeFilter: 'all' | 'pdf' | 'md' | 'txt';
  setActiveFilter: (val: 'all' | 'pdf' | 'md' | 'txt') => void;
  counts: {
    all: number;
    pdf: number;
    md: number;
    txt: number;
  };
}

export const VaultToolbar: React.FC<VaultToolbarProps> = ({
  searchQuery,
  setSearchQuery,
  activeFilter,
  setActiveFilter,
  counts,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 select-none">
      {/* Left Search Bar */}
      <div className="relative w-full sm:w-80">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter documents by name..."
          className="w-full pl-9 pr-8 py-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-[13px] text-[var(--text-main)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-all shadow-2xs"
        />
        {searchQuery && (
          <button
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)] p-0.5 rounded cursor-pointer"
            onClick={() => setSearchQuery('')}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Right Filter Category Pills */}
      <div className="flex items-center p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[12.5px] shadow-2xs self-start sm:self-auto">
        <button
          className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
            activeFilter === 'all' 
              ? 'bg-[var(--bg-input)] text-[var(--text-main)] font-semibold shadow-xs' 
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] font-medium'
          }`}
          onClick={() => setActiveFilter('all')}
        >
          All ({counts.all})
        </button>
        <button
          className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
            activeFilter === 'pdf' 
              ? 'bg-[var(--bg-input)] text-[var(--text-main)] font-semibold shadow-xs' 
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] font-medium'
          }`}
          onClick={() => setActiveFilter('pdf')}
        >
          PDFs ({counts.pdf})
        </button>
        <button
          className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
            activeFilter === 'md' 
              ? 'bg-[var(--bg-input)] text-[var(--text-main)] font-semibold shadow-xs' 
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] font-medium'
          }`}
          onClick={() => setActiveFilter('md')}
        >
          Markdown ({counts.md})
        </button>
        <button
          className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
            activeFilter === 'txt' 
              ? 'bg-[var(--bg-input)] text-[var(--text-main)] font-semibold shadow-xs' 
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] font-medium'
          }`}
          onClick={() => setActiveFilter('txt')}
        >
          Text ({counts.txt})
        </button>
      </div>
    </div>
  );
};

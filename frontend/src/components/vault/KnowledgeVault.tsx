import React, { useState } from 'react';
import { RefreshCw, UploadCloud, Plus, Database } from 'lucide-react';
import { DocumentItem, CollectionStats } from '../../types/document';
import { VaultToolbar } from './VaultToolbar';
import { VaultDocList, SortField, SortDirection } from './VaultDocList';
import { VaultUploadModal } from './VaultUploadModal';
import { VaultBottomRibbon } from './VaultBottomRibbon';
import { GitHubConnectorModal } from './GitHubConnectorModal';

const GitHubIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

interface KnowledgeVaultProps {
  documents: DocumentItem[];
  stats: CollectionStats;
  isUploading: boolean;
  onUpload: (files: FileList | File[]) => void;
  onRefresh: () => Promise<void> | void;
  onInspect: (doc: { filename: string; content?: string }) => void;
  onDownload: (filename: string) => void;
  onReindex: (filename: string) => void;
  onEnhance: (filename: string) => void;
  onDelete: (filename: string) => void;
  onBatchDelete?: (filenames: string[]) => void;
  onBatchReindex?: (filenames: string[]) => void;
  onBatchEnhance?: (filenames: string[]) => void;
  onBatchDownload?: (filenames: string[]) => void;
  onAddDocument?: (doc: DocumentItem) => void;
  showToast: (msg: string) => void;
}

export const KnowledgeVault: React.FC<KnowledgeVaultProps> = ({
  documents,
  stats,
  isUploading,
  onUpload,
  onRefresh,
  onInspect,
  onDownload,
  onReindex,
  onEnhance,
  onDelete,
  onBatchDelete,
  onBatchReindex,
  onBatchEnhance,
  onBatchDownload,
  onAddDocument,
  showToast,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'pdf' | 'md' | 'txt'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isDragOverWindow, setIsDragOverWindow] = useState<boolean>(false);
  const [selectedFilenames, setSelectedFilenames] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState<boolean>(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);

  const totalMb = documents.reduce((acc, d) => acc + (d.size_mb || 0), 0);
  const pdfCount = documents.filter(d => d.filename.toLowerCase().endsWith('.pdf')).length;
  const mdCount = documents.filter(d => d.filename.toLowerCase().endsWith('.md')).length;
  const txtCount = documents.filter(d => d.filename.toLowerCase().endsWith('.txt')).length;

  // In-Header Column Sorting Handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredDocuments = documents
    .filter(doc => {
      const matches = doc.filename.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matches) return false;
      const ext = doc.filename.split('.').pop()?.toLowerCase();
      if (activeFilter === 'pdf') return ext === 'pdf';
      if (activeFilter === 'md') return ext === 'md';
      if (activeFilter === 'txt') return ext === 'txt';
      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.filename.localeCompare(b.filename);
      } else if (sortField === 'type') {
        const extA = a.filename.split('.').pop()?.toLowerCase() || '';
        const extB = b.filename.split('.').pop()?.toLowerCase() || '';
        comparison = extA.localeCompare(extB);
      } else if (sortField === 'size') {
        comparison = (a.size_mb || 0) - (b.size_mb || 0);
      } else if (sortField === 'pages') {
        comparison = (a.pages || 0) - (b.pages || 0);
      } else if (sortField === 'status') {
        comparison = (a.indexed ? 1 : 0) - (b.indexed ? 1 : 0);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

  // Multi-Selection Logic
  const handleToggleSelect = (filename: string) => {
    setSelectedFilenames(prev => 
      prev.includes(filename) 
        ? prev.filter(f => f !== filename) 
        : [...prev, filename]
    );
  };

  const handleSelectAll = () => {
    if (selectedFilenames.length === filteredDocuments.length) {
      setSelectedFilenames([]);
    } else {
      setSelectedFilenames(filteredDocuments.map(d => d.filename));
    }
  };

  const handleClearSelection = () => {
    setSelectedFilenames([]);
  };

  const handleSyncClick = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    showToast("Syncing with Qdrant vector database...");
    try {
      await onRefresh();
      showToast("✓ Vault synchronized successfully");
    } catch (error: any) {
      console.error("Sync error:", error);
      showToast(`✗ Sync failed: ${error?.message || "Unknown error"}`);
    } finally {
      setTimeout(() => setIsSyncing(false), 300);
    }
  };

  // Full-Window Drag & Drop Handlers
  const handleWindowDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragOverWindow) setIsDragOverWindow(true);
  };

  const handleWindowDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverWindow(false);
  };

  const handleWindowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverWindow(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setDroppedFiles(Array.from(e.dataTransfer.files));
      setIsUploadModalOpen(true);
    }
  };

  return (
    <div 
      className="relative flex flex-col h-full w-full bg-[var(--bg-dark)] select-none fade-in overflow-hidden"
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
    >
      {/* Full-Page Drag-and-Drop Active Overlay */}
      {isDragOverWindow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-[var(--bg-dark)]/90 backdrop-blur-md border-2 border-dashed border-[var(--accent-primary)] animate-pulse pointer-events-none">
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent-primary)] mx-auto flex items-center justify-center mb-3 shadow-lg">
              <UploadCloud size={28} />
            </div>
            <h2 className="text-base font-semibold text-[var(--text-main)] mb-1">
              Drop files anywhere to ingest
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              PDFs, Markdown, and Text documents will be automatically chunked and indexed.
            </p>
          </div>
        </div>
      )}

      {/* Main Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 md:px-10 md:py-8">
        <div className="w-full space-y-4">
          
          {/* Prominent Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[var(--border-color)]">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <Database size={22} className="text-[var(--accent-primary)] flex-shrink-0" />
                <h1 className="font-serif text-[24px] font-normal text-[var(--text-main)] tracking-tight">
                  Knowledge Vault
                </h1>
                <div 
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border"
                  style={{
                    backgroundColor: 'var(--status-active-bg)',
                    color: 'var(--status-active-text)',
                    borderColor: 'var(--status-active-border)',
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-active-text)] animate-pulse" />
                  <span>Qdrant Vector DB Active</span>
                </div>
              </div>
              <p className="text-[13px] text-[var(--text-muted)] max-w-2xl leading-relaxed">
                Multi-document vector corpus with parent-child hierarchical chunking, dense embeddings, and BM25 hybrid retrieval.
              </p>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                className="h-9 px-3.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] text-[13px] font-medium transition-colors inline-flex items-center gap-2 cursor-pointer shadow-2xs active:scale-[0.98]"
                onClick={handleSyncClick}
                title="Synchronize index with Qdrant vector database"
              >
                <RefreshCw size={13.5} className={isSyncing ? 'animate-spin text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} />
                <span>Sync</span>
              </button>

              <button
                className="h-9 px-3.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] text-[13px] font-medium transition-colors inline-flex items-center gap-2 cursor-pointer shadow-2xs active:scale-[0.98]"
                onClick={() => setIsGitHubModalOpen(true)}
                title="Connect a GitHub repository"
              >
                <GitHubIcon size={14} className="text-[var(--text-muted)]" />
                <span>GitHub</span>
              </button>

              <button
                className="h-9 px-4 rounded-lg bg-[var(--accent-primary)] text-white hover:opacity-95 text-[13px] font-medium transition-all inline-flex items-center gap-2 cursor-pointer shadow-xs active:scale-[0.98]"
                onClick={() => setIsUploadModalOpen(true)}
              >
                <UploadCloud size={14.5} />
                <span>Upload Documents</span>
              </button>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <VaultToolbar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            counts={{
              all: documents.length,
              pdf: pdfCount,
              md: mdCount,
              txt: txtCount,
            }}
          />

          {/* Prominent Enterprise Data Table */}
          <VaultDocList
            documents={filteredDocuments}
            selectedFilenames={selectedFilenames}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onInspect={onInspect}
            onDownload={onDownload}
            onReindex={onReindex}
            onEnhance={onEnhance}
            onDelete={onDelete}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            hasSearchQuery={!!searchQuery}
            onResetSearch={() => { setSearchQuery(''); setActiveFilter('all'); }}
          />
        </div>
      </div>

      {/* Docked Bottom Status & Metrics Ribbon with Integrated Bulk Actions */}
      <VaultBottomRibbon
        totalFiles={documents.length}
        totalMb={totalMb}
        totalChunks={stats.total_chunks || (documents.length * 120)}
        selectedFilenames={selectedFilenames}
        documents={documents}
        onClearSelection={handleClearSelection}
        onBatchReindex={(filenames) => {
          onBatchReindex?.(filenames);
          handleClearSelection();
        }}
        onBatchEnhance={onBatchEnhance ? (filenames) => {
          onBatchEnhance(filenames);
          handleClearSelection();
        } : undefined}
        onBatchDownload={(filenames) => {
          onBatchDownload?.(filenames);
          handleClearSelection();
        }}
        onBatchDelete={(filenames) => {
          onBatchDelete?.(filenames);
          handleClearSelection();
        }}
      />

      {/* Dedicated Upload Modal */}
      <VaultUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          setDroppedFiles(null);
        }}
        onUploadSuccess={onRefresh}
        onAddDocument={onAddDocument}
        initialFiles={droppedFiles}
        showToast={showToast}
      />

      {/* GitHub Connector Modal */}
      <GitHubConnectorModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        onSyncComplete={onRefresh}
        onAddDocument={onAddDocument}
        showToast={showToast}
      />
    </div>
  );
};

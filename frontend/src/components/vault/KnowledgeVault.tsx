import React, { useState } from 'react';
import { RefreshCw, UploadCloud, Plus, Database, Trash2, Loader2 } from 'lucide-react';
import { DocumentItem, CollectionStats, PipelineHealth } from '../../types/document';
import { VaultToolbar } from './VaultToolbar';
import { VaultDocList, SortField, SortDirection } from './VaultDocList';
import { VaultUploadModal } from './VaultUploadModal';
import { VaultBottomRibbon } from './VaultBottomRibbon';
import { UploadProgressItem } from '../common/UploadProgressItem';

interface KnowledgeVaultProps {
  documents: DocumentItem[];
  stats: CollectionStats;
  health: PipelineHealth | null;
  isLoading?: boolean;
  isUploading: boolean;
  onUpload: (files: FileList | File[]) => void;
  onRefresh: () => void;
  onInspect: (doc: { filename: string; content?: string }) => void;
  onDownload: (filename: string) => void;
  onReindex: (filename: string) => void;
  onDelete: (filename: string) => void;
  onBatchDelete?: (filenames: string[]) => void;
  onBatchReindex?: (filenames: string[]) => void;
  onBatchDownload?: (filenames: string[]) => void;
  onCleanupOrphaned?: () => void;
  onCancelUpload?: (uploadId?: string, filename?: string) => void;
  showToast: (msg: string) => void;
}

export const KnowledgeVault: React.FC<KnowledgeVaultProps> = ({
  documents,
  stats,
  health,
  isLoading = false,
  isUploading,
  onUpload,
  onRefresh,
  onInspect,
  onDownload,
  onReindex,
  onDelete,
  onBatchDelete,
  onBatchReindex,
  onBatchDownload,
  onCleanupOrphaned,
  onCancelUpload,
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

  const totalMb = documents.reduce((acc, d) => acc + (d.size_mb || 0), 0);
  const pdfCount = documents.filter(d => d.filename.toLowerCase().endsWith('.pdf')).length;
  const mdCount = documents.filter(d => d.filename.toLowerCase().endsWith('.md')).length;
  const txtCount = documents.filter(d => d.filename.toLowerCase().endsWith('.txt')).length;
  
  // Separate uploading documents from completed ones
  const uploadingDocs = documents.filter(d => !d.indexed && (d.status === 'uploading' || d.status === 'processing'));
  const completedDocs = documents.filter(d => d.indexed || (d.status !== 'uploading' && d.status !== 'processing'));

  // In-Header Column Sorting Handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredDocuments = completedDocs
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
    // Only allow selection of completed documents
    const doc = documents.find(d => d.filename === filename);
    if (doc && (doc.status === 'uploading' || doc.status === 'processing')) {
      return; // Don't allow selection of uploading files
    }
    
    setSelectedFilenames(prev => 
      prev.includes(filename) 
        ? prev.filter(f => f !== filename) 
        : [...prev, filename]
    );
  };

  const handleSelectAll = () => {
    const selectableDocs = filteredDocuments.filter(d => 
      d.status !== 'uploading' && d.status !== 'processing'
    );
    
    if (selectedFilenames.length === selectableDocs.length) {
      setSelectedFilenames([]);
    } else {
      setSelectedFilenames(selectableDocs.map(d => d.filename));
    }
  };

  const handleClearSelection = () => {
    setSelectedFilenames([]);
  };

  const handleSyncClick = async () => {
    setIsSyncing(true);
    await onRefresh();
    setTimeout(() => {
      setIsSyncing(false);
      showToast("Vault synchronized");
    }, 400);
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
      onUpload(e.dataTransfer.files);
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

              {onCleanupOrphaned && (
                <button
                  className="h-9 px-3.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] text-[13px] font-medium transition-colors inline-flex items-center gap-2 cursor-pointer shadow-2xs active:scale-[0.98]"
                  onClick={onCleanupOrphaned}
                  title="Remove orphaned vectors from Qdrant"
                >
                  <Database size={13.5} className="text-[var(--text-muted)]" />
                  <span>Cleanup</span>
                </button>
              )}

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
              all: completedDocs.length,
              pdf: completedDocs.filter(d => d.filename.toLowerCase().endsWith('.pdf')).length,
              md: completedDocs.filter(d => d.filename.toLowerCase().endsWith('.md')).length,
              txt: completedDocs.filter(d => d.filename.toLowerCase().endsWith('.txt')).length,
            }}
          />

          {/* Minimalist Premium Ingestion Status Card */}
          {uploadingDocs.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden shadow-2xs mb-4 select-none animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Card Sub-Header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-sidebar)] border-b border-[var(--border-color)] text-xs">
                <div className="flex items-center gap-2 font-medium text-[var(--text-main)]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent-primary)] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent-primary)]" />
                  </span>
                  <span className="font-semibold">
                    Ingesting {uploadingDocs.length} {uploadingDocs.length === 1 ? 'Document' : 'Documents'}
                  </span>
                  <span className="text-[var(--text-muted)] text-[11.5px] hidden sm:inline">
                    · Hierarchical chunking & Graph RAG
                  </span>
                </div>
              </div>

              {/* Ingestion Items List */}
              <div className="divide-y divide-[var(--border-color)]/60">
                {uploadingDocs.map(doc => (
                  <UploadProgressItem
                    key={doc.filename}
                    filename={doc.filename}
                    status={doc.status || 'uploading'}
                    progress={doc.progress || 0}
                    stage={doc.stage}
                    error={doc.error}
                    onCancel={onCancelUpload ? () => onCancelUpload(doc.upload_id, doc.filename) : undefined}
                    onRetry={() => onReindex(doc.filename)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Prominent Enterprise Data Table */}
          <VaultDocList
            documents={filteredDocuments}
            selectedFilenames={selectedFilenames}
            isLoading={isLoading}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onInspect={onInspect}
            onDownload={onDownload}
            onReindex={onReindex}
            onDelete={onDelete}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            hasSearchQuery={!!searchQuery}
            onResetSearch={() => { setSearchQuery(''); setActiveFilter('all'); }}
          />
        </div>
      </div>

      {/* Docked Bottom Status, Metrics & In-Place Mass Operations Ribbon */}
      <VaultBottomRibbon
        totalFiles={completedDocs.length}
        totalMb={totalMb}
        totalChunks={stats.total_chunks || (completedDocs.length * 120)}
        health={health}
        selectedFilenames={selectedFilenames}
        documents={completedDocs}
        onClearSelection={handleClearSelection}
        onBatchReindex={(filenames) => {
          onBatchReindex?.(filenames);
          handleClearSelection();
        }}
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
        onClose={() => setIsUploadModalOpen(false)}
        onUpload={onUpload}
        isUploading={isUploading}
        showToast={showToast}
      />
    </div>
  );
};

import React from 'react';
import { Eye, Download, RotateCw, Trash2, Check, BookOpen, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { DocumentItem } from '../../types/document';
import { FormatBadge } from '../common/FormatBadge';

export type SortField = 'name' | 'type' | 'size' | 'pages' | 'status';
export type SortDirection = 'asc' | 'desc';

interface VaultDocListProps {
  documents: DocumentItem[];
  selectedFilenames: string[];
  onToggleSelect: (filename: string) => void;
  onSelectAll: () => void;
  onInspect: (doc: { filename: string; content?: string }) => void;
  onDownload: (filename: string) => void;
  onReindex: (filename: string) => void;
  onDelete: (filename: string) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  hasSearchQuery: boolean;
  onResetSearch: () => void;
}

export const VaultDocList: React.FC<VaultDocListProps> = ({
  documents = [],
  selectedFilenames = [],
  onToggleSelect = () => {},
  onSelectAll = () => {},
  onInspect,
  onDownload,
  onReindex,
  onDelete,
  sortField = 'name',
  sortDirection = 'asc',
  onSort,
  hasSearchQuery,
  onResetSearch,
}) => {
  const isAllSelected = documents.length > 0 && selectedFilenames.length === documents.length;
  const isIndeterminate = selectedFilenames.length > 0 && selectedFilenames.length < documents.length;

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-14 text-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] fade-in">
        <BookOpen size={40} className="text-[var(--text-muted)] mb-3 opacity-50" />
        <h3 className="text-sm font-semibold text-[var(--text-main)] mb-1">
          {hasSearchQuery ? "No matching documents found" : "Knowledge Vault is empty"}
        </h3>
        <p className="text-xs text-[var(--text-muted)] max-w-sm mb-4 leading-relaxed">
          {hasSearchQuery 
            ? "Try adjusting your search query or reset the category filters." 
            : "Upload PDF research papers, Markdown notes, or text files to begin vector querying."}
        </p>
        {hasSearchQuery && (
          <button
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[var(--bg-input)] text-[var(--text-main)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-colors cursor-pointer"
            onClick={onResetSearch}
          >
            Reset search filter
          </button>
        )}
      </div>
    );
  }

  // Column Sort Header Helper Component
  const SortableHeader: React.FC<{
    field: SortField;
    label: string;
    className?: string;
    align?: 'left' | 'right';
  }> = ({ field, label, className = '', align = 'left' }) => {
    const isActive = sortField === field;
    return (
      <th 
        className={`py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] select-none cursor-pointer hover:text-[var(--text-main)] transition-colors group ${className}`}
        onClick={() => onSort(field)}
      >
        <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
          <span>{label}</span>
          <span className="flex-shrink-0 transition-opacity">
            {isActive ? (
              sortDirection === 'asc' ? (
                <ArrowUp size={12} className="text-[var(--accent-primary)] font-bold" />
              ) : (
                <ArrowDown size={12} className="text-[var(--accent-primary)] font-bold" />
              )
            ) : (
              <ArrowUpDown size={11} className="opacity-0 group-hover:opacity-60 text-[var(--text-muted)]" />
            )}
          </span>
        </div>
      </th>
    );
  };

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden shadow-2xs select-none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]">
              {/* Master Select-All Checkbox */}
              <th className="py-3 px-4 w-12 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = isIndeterminate;
                  }}
                  onChange={onSelectAll}
                  className="w-4 h-4 rounded border-[var(--border-color)] text-[var(--accent-primary)] accent-[var(--accent-primary)] cursor-pointer"
                />
              </th>

              {/* Sortable Column Headers */}
              <SortableHeader field="name" label="Document" className="w-[42%]" />
              <SortableHeader field="type" label="Format" className="w-[14%]" />
              <SortableHeader field="size" label="Size" className="w-[12%]" />
              <SortableHeader field="pages" label="Pages" className="w-[10%]" />
              <SortableHeader field="status" label="Vector Status" className="w-[12%]" />

              <th className="py-3 px-5 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] w-[10%]">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--border-color)]">
            {documents.map((doc) => {
              const ext = doc.filename.split('.').pop()?.toLowerCase() || '';
              const isPdf = ext === 'pdf';
              const isMd = ext === 'md';
              const isSelected = selectedFilenames.includes(doc.filename);

              return (
                <tr
                  key={doc.filename}
                  className={`cursor-pointer transition-all duration-150 group ${
                    isSelected 
                      ? 'bg-[var(--accent-subtle)] font-medium' 
                      : 'hover:bg-[var(--bg-hover)]'
                  }`}
                  onClick={() => onInspect({ filename: doc.filename })}
                >
                  {/* Row Checkbox */}
                  <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(doc.filename)}
                      className="w-4 h-4 rounded border-[var(--border-color)] text-[var(--accent-primary)] accent-[var(--accent-primary)] cursor-pointer"
                    />
                  </td>

                  {/* Document Name */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <FormatBadge filename={doc.filename} size="sm" />
                      <span 
                        className="font-semibold text-[13.5px] text-[var(--text-main)] truncate max-w-sm lg:max-w-md group-hover:text-[var(--accent-primary)] transition-colors" 
                        title={doc.filename}
                      >
                        {doc.filename}
                      </span>
                    </div>
                  </td>

                  {/* Format */}
                  <td className="py-3.5 px-4 text-[var(--text-muted)] text-[12.5px]">
                    {isPdf ? 'PDF Document' : isMd ? 'Markdown Spec' : 'Plaintext File'}
                  </td>

                  {/* Size */}
                  <td className="py-3.5 px-4 font-mono text-[12.5px] text-[var(--text-main)] font-semibold">
                    {doc.size_mb} MB
                  </td>

                  {/* Pages */}
                  <td className="py-3.5 px-4 text-[var(--text-muted)] text-[12.5px] font-mono">
                    {doc.pages || 1} {doc.pages === 1 ? 'page' : 'pages'}
                  </td>

                  {/* Vector Index Status Micro-Pill */}
                  <td className="py-3.5 px-4">
                    <span 
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border shadow-2xs"
                      style={{
                        backgroundColor: 'var(--status-active-bg)',
                        color: 'var(--status-active-text)',
                        borderColor: 'var(--status-active-border)',
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-active-text)]" />
                      <span>Indexed</span>
                    </span>
                  </td>

                  {/* Actions Bar */}
                  <td className="py-3.5 px-5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-input)] transition-colors cursor-pointer"
                        onClick={() => onInspect({ filename: doc.filename })}
                        title="Inspect in Sidecar Reader"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-input)] transition-colors cursor-pointer"
                        onClick={() => onDownload(doc.filename)}
                        title="Download Document"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-input)] transition-colors cursor-pointer"
                        onClick={() => onReindex(doc.filename)}
                        title="Re-index Vector Embeddings"
                      >
                        <RotateCw size={14} />
                      </button>
                      <button
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                        onClick={() => onDelete(doc.filename)}
                        title="Delete from Knowledge Base"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

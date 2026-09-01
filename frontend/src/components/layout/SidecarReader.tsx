import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  Download, 
  FileText, 
  ChevronLeft, 
  ChevronRight, 
  Copy, 
  Check, 
  RotateCcw, 
  Maximize2, 
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../services/api';
import { FormatBadge } from '../common/FormatBadge';
import { OrbitingOrbLoader } from '../common/OrbitingOrbLoader';

interface SidecarReaderProps {
  isOpen: boolean;
  onClose: () => void;
  document: { filename: string; content?: string; page?: number } | null;
}

export const SidecarReader: React.FC<SidecarReaderProps> = ({ isOpen, onClose, document: doc }) => {
  const [content, setContent] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(100);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPageLoading, setIsPageLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Initialize or update document state
  useEffect(() => {
    if (!doc?.filename) return;

    setCurrentPage(doc.page || 1);
    setZoom(100);

    const isPdf = doc.filename.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      api.getPdfInfo(doc.filename)
        .then(data => setTotalPages(data.total_pages || 1))
        .catch(() => setTotalPages(1));
    }

    setIsLoading(true);
    api.getFileContent(doc.filename)
      .then(data => {
        setContent(data.content || doc.content || "Content unavailable.");
      })
      .catch(() => {
        setContent(doc.content || "Content unavailable.");
      })
      .finally(() => setIsLoading(false));
  }, [doc]);

  // Load PDF page image blob with authenticated token
  useEffect(() => {
    if (!doc?.filename || !doc.filename.toLowerCase().endsWith('.pdf')) {
      setPageImageUrl(null);
      return;
    }

    let active = true;
    let createdUrl: string | null = null;
    setIsPageLoading(true);

    api.getPdfPageImageBlob(doc.filename, currentPage)
      .then(url => {
        if (active) {
          createdUrl = url;
          setPageImageUrl(url);
        } else {
          URL.revokeObjectURL(url);
        }
      })
      .catch(err => {
        console.error("PDF page image load failed:", err);
        if (active) setPageImageUrl(null);
      })
      .finally(() => {
        if (active) setIsPageLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [doc?.filename, currentPage]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const isPdf = doc?.filename ? doc.filename.toLowerCase().endsWith('.pdf') : false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && isPdf) {
        setCurrentPage(p => Math.max(1, p - 1));
      } else if (e.key === 'ArrowRight' && isPdf) {
        setCurrentPage(p => Math.min(totalPages, p + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, totalPages, doc?.filename, onClose]);

  const handleCopyText = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleDownload = async () => {
    if (!doc?.filename) return;
    try {
      await api.downloadFile(doc.filename);
    } catch (e) {
      console.error("Download failed:", e);
    }
  };

  const isPdf = doc?.filename ? doc.filename.toLowerCase().endsWith('.pdf') : false;

  return (
    <aside 
      className={`h-full border-l border-[var(--border-color)] bg-[var(--bg-dark)] flex flex-col z-30 select-none overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isOpen && doc 
          ? 'fixed inset-0 z-50 w-full min-w-full max-w-full md:relative md:z-30 md:w-1/2 md:min-w-[380px] md:max-w-[50vw] opacity-100 shadow-2xl' 
          : 'w-0 min-w-0 max-w-0 opacity-0 border-l-0 pointer-events-none'
      }`}
    >
      {doc && (
        <div className="w-full min-w-0 md:min-w-[380px] h-full flex flex-col bg-[var(--bg-dark)]">
      {/* Top Premium Workstation Header */}
      <header className="h-14 px-4 sm:px-5 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-card)] z-10 select-none flex-shrink-0">
        {/* Document Title & Format Metadata */}
        <div className="flex items-center gap-2.5 min-w-0 max-w-[48%]">
          <FormatBadge filename={doc.filename} size="sm" />
          <div className="flex flex-col min-w-0">
            <span className="text-[13.5px] font-semibold tracking-tight text-[var(--text-main)] truncate" title={doc.filename}>
              {doc.filename}
            </span>
            <span className="text-[10.5px] text-[var(--text-muted)] flex items-center gap-1 font-medium tracking-wide">
              <ShieldCheck size={11} className="text-[var(--accent-primary)] flex-shrink-0" />
              Verified Knowledge Source {isPdf && `· Page ${currentPage} of ${totalPages}`}
            </span>
          </div>
        </div>

        {/* Action Controls & Navigation Toolbar */}
        <div className="flex items-center gap-2">
          {/* Multi-Page Segmented Navigation Pill */}
          {isPdf && totalPages > 1 && (
            <div className="flex items-center bg-[var(--bg-input)] rounded-lg p-0.5 border border-[var(--border-color)] shadow-xs">
              <button 
                className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                onClick={() => {
                  setIsPageLoading(true);
                  setCurrentPage(prev => Math.max(1, prev - 1));
                }}
                disabled={currentPage <= 1}
                title="Previous page (Left Arrow)"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="font-mono text-xs font-semibold px-2 text-[var(--text-main)] select-none">
                {currentPage} / {totalPages}
              </span>
              <button 
                className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                onClick={() => {
                  setIsPageLoading(true);
                  setCurrentPage(prev => Math.min(totalPages, prev + 1));
                }}
                disabled={currentPage >= totalPages}
                title="Next page (Right Arrow)"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* Zoom Segmented Controls */}
          <div className="flex items-center bg-[var(--bg-input)] rounded-lg p-0.5 border border-[var(--border-color)] shadow-xs">
            <button 
              className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-30 transition-all cursor-pointer"
              onClick={() => setZoom(prev => Math.max(50, prev - 15))}
              disabled={zoom <= 50}
              title="Zoom Out"
            >
              <ZoomOut size={13} />
            </button>
            <button 
              className="px-1.5 text-[11px] font-mono font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer"
              onClick={() => setZoom(100)}
              title="Reset Zoom to 100%"
            >
              {zoom}%
            </button>
            <button 
              className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-30 transition-all cursor-pointer"
              onClick={() => setZoom(prev => Math.min(180, prev + 15))}
              disabled={zoom >= 180}
              title="Zoom In"
            >
              <ZoomIn size={13} />
            </button>
          </div>

          {/* Copy Text Button */}
          {!isPdf && (
            <button 
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] shadow-xs transition-all cursor-pointer"
              onClick={handleCopyText}
              title="Copy document content"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            </button>
          )}

          {/* Download Original File */}
          <button 
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] shadow-xs transition-all cursor-pointer"
            onClick={handleDownload}
            title="Download original file"
          >
            <Download size={14} />
          </button>

          {/* Close Sidecar */}
          <button 
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-red-500 hover:border-red-400/50 hover:bg-red-500/10 shadow-xs transition-all cursor-pointer ml-0.5"
            onClick={onClose}
            title="Close Preview (Esc)"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {/* Main Document Viewport - Direct Native Page Canvas */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[var(--bg-dark)] flex flex-col items-center justify-start">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center p-12">
            <OrbitingOrbLoader size="lg" />
          </div>
        ) : isPdf && pageImageUrl ? (
          <div className="w-full flex flex-col items-center justify-start">
            <div 
              className="relative w-full flex justify-center"
              style={{ 
                transform: zoom === 100 ? undefined : `scale(${zoom / 100})`, 
                transformOrigin: 'top center',
                transition: 'transform 150ms ease-out'
              }}
            >
              <img 
                src={pageImageUrl} 
                alt={`Page ${currentPage} of ${doc.filename}`}
                className={`w-full h-auto block select-text transition-opacity duration-200 ${isPageLoading ? 'opacity-40' : 'opacity-100'}`}
                style={{ imageRendering: '-webkit-optimize-contrast' }}
                loading="eager"
              />

              {/* Shimmer loading overlay for page transitions */}
              {isPageLoading && (
                <div className="absolute inset-0 bg-white/50 dark:bg-black/50 backdrop-blur-xs flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-[var(--accent-primary)] border-t-transparent animate-spin" />
                </div>
              )}
            </div>

            {/* Bottom Page Indicator Pill */}
            {totalPages > 1 && (
              <div className="my-4 px-3.5 py-1.5 rounded-full bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-color)] shadow-sm text-xs font-mono text-[var(--text-muted)] select-none">
                Page {currentPage} of {totalPages}
              </div>
            )}
          </div>
        ) : (
          /* Text / Markdown Render Directly in Viewport (or PDF text fallback) */
          <div 
            className="w-full p-6 sm:p-8 omni-prose"
            style={{ 
              fontSize: `${(zoom / 100) * 0.95}rem`,
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => (
                  <div className="overflow-x-auto my-3.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-xs">
                    <table className="min-w-full divide-y divide-[var(--border-color)] text-xs text-left">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-[var(--bg-sidebar)] text-[var(--text-muted)] font-semibold text-[11.5px] uppercase tracking-wider">
                    {children}
                  </thead>
                ),
                th: ({ children }) => (
                  <th className="px-3.5 py-2.5 font-semibold text-[var(--text-main)] border-b border-[var(--border-color)] whitespace-nowrap">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-3.5 py-2.5 text-[var(--text-main)] border-b border-[var(--border-color)]/40 leading-relaxed align-top">
                    {children}
                  </td>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-[var(--bg-hover)]/40 transition-colors last:border-b-0">
                    {children}
                  </tr>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
    )}
    </aside>
  );
};

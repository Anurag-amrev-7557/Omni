import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  Download, 
  ChevronLeft, 
  ChevronRight, 
  Copy, 
  Check, 
  ShieldCheck,
  Globe,
  ExternalLink
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '../../services/api';
import { FormatBadge } from '../common/FormatBadge';
import { OrbitingOrbLoader } from '../common/OrbitingOrbLoader';

interface SidecarReaderProps {
  isOpen: boolean;
  onClose: () => void;
  document: {
    filename: string;
    content?: string;
    page?: number;
    url?: string;
    is_web?: boolean;
  } | null;
}

export const SidecarReader: React.FC<SidecarReaderProps> = React.memo(({ isOpen, onClose, document: doc }) => {
  const [content, setContent] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(100);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPageLoading, setIsPageLoading] = useState<boolean>(false);
  const [imgError, setImgError] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const isWeb = Boolean(
    doc?.is_web ||
    doc?.url ||
    doc?.filename?.startsWith('[Web]') ||
    doc?.filename?.startsWith('http://') ||
    doc?.filename?.startsWith('https://')
  );

  const resolvedUrl = doc?.url || (
    doc?.content?.match(/Source URL:\s*(https?:\/\/[^\s]+)/i)?.[1] ||
    doc?.filename?.match(/(https?:\/\/[^\s)]+)/)?.[1] ||
    (doc?.filename?.startsWith('http') ? doc.filename : undefined)
  );

  const cleanTitle = (doc?.filename || 'Document')
    .replace(/^\[Web\]\s*/i, '')
    .replace(/https?:\/\/[^\s)]+/g, '')
    .replace(/[()[\]]/g, ' ')
    .trim() || resolvedUrl || 'Web Source';

  useEffect(() => {
    if (!doc?.filename) return;

    setCurrentPage(doc.page || 1);
    setZoom(100);
    setImgError(false);
    setIsPageLoading(true);

    if (isWeb) {
      setIsLoading(false);
      setContent(doc.content || "Web content excerpt unavailable.");
      return;
    }

    const isPdfDoc = doc.filename.toLowerCase().endsWith('.pdf');
    if (isPdfDoc) {
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
  }, [doc, isWeb]);

  const isPdf = !isWeb && (doc?.filename ? doc.filename.toLowerCase().endsWith('.pdf') : false);

  useEffect(() => {
    if (!isOpen) return;

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
  }, [isOpen, totalPages, onClose, isPdf]);

  const handleCopyText = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

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
          <header className="h-14 px-4 sm:px-5 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-card)] z-10 select-none flex-shrink-0">
            <div className="flex items-center gap-2.5 min-w-0 max-w-[55%]">
              <FormatBadge filename={isWeb ? '[Web]' : doc.filename} size="sm" />
              <div className="flex flex-col min-w-0">
                <span className="text-[13.5px] font-semibold tracking-tight text-[var(--text-main)] truncate" title={cleanTitle}>
                  {cleanTitle}
                </span>
                <span className="text-[10.5px] text-[var(--text-muted)] flex items-center gap-1 font-medium tracking-wide">
                  {isWeb ? (
                    <>
                      <Globe size={11} className="text-[var(--accent-primary)] flex-shrink-0" />
                      Live Web Search Source
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={11} className="text-[var(--accent-primary)] flex-shrink-0" />
                      Verified Knowledge Source {isPdf && `· Page ${currentPage} of ${totalPages}`}
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
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

              {!isWeb && (
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
              )}

              {isWeb && resolvedUrl && (
                <a
                  href={resolvedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-xs text-[var(--accent-primary)] hover:text-[var(--accent-hover)] font-medium transition-all shadow-xs cursor-pointer"
                  title="Open source in new browser tab"
                >
                  <span className="hidden sm:inline">Visit Site</span>
                  <ExternalLink size={13} />
                </a>
              )}

              <button 
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] shadow-xs transition-all cursor-pointer"
                onClick={handleCopyText}
                title="Copy content"
              >
                {copied ? <Check size={14} className="text-[var(--status-active-text)]" /> : <Copy size={14} />}
              </button>

              {!isWeb && (
                <button 
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] shadow-xs transition-all cursor-pointer"
                  onClick={() => window.open(api.getDownloadUrl(doc.filename), '_blank')}
                  title="Download original file"
                >
                  <Download size={14} />
                </button>
              )}

              <button 
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--danger-text)] hover:border-[var(--danger-border)] hover:bg-[var(--danger-bg)] shadow-xs transition-all cursor-pointer ml-0.5"
                onClick={onClose}
                title="Close Preview (Esc)"
              >
                <X size={15} />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[var(--bg-dark)] flex flex-col items-center justify-start">
            {isLoading ? (
              <div className="h-full flex flex-col items-center justify-center p-12">
                <OrbitingOrbLoader size="lg" state="searching" />
              </div>
            ) : isWeb ? (
              <div className="w-full max-w-3xl p-6 sm:p-8 flex flex-col gap-6">
                <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-sm flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center flex-shrink-0 shadow-2xs">
                        <Globe size={18} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-primary)] font-mono">
                          Live Web Search Reference
                        </span>
                        <h2 className="text-[15px] font-semibold text-[var(--text-main)] tracking-tight leading-snug">
                          {cleanTitle}
                        </h2>
                      </div>
                    </div>

                    {resolvedUrl && (
                      <a
                        href={resolvedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold tracking-wide transition-all shadow-xs cursor-pointer shrink-0"
                      >
                        <span>Open in Browser</span>
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>

                  {resolvedUrl && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-xs font-mono text-[var(--text-muted)] select-all truncate">
                      <ExternalLink size={12} className="shrink-0 text-[var(--text-muted)]" />
                      <span className="truncate">{resolvedUrl}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Grounded Excerpt & Synthesis
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-muted)]">
                      Retrieved via Tavily AI
                    </span>
                  </div>

                  <div 
                    className="w-full p-6 rounded-2xl bg-[var(--bg-card)]/80 border border-[var(--border-color)] omni-prose shadow-2xs leading-relaxed"
                    style={{ fontSize: `${(zoom / 100) * 0.95}rem` }}
                  >
                    <ReactMarkdown>{content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : isPdf && !imgError ? (
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
                    src={api.getPdfPageImageUrl(doc.filename, currentPage)} 
                    alt={`Page ${currentPage} of ${doc.filename}`}
                    onLoad={() => setIsPageLoading(false)}
                    onError={() => {
                      setImgError(true);
                      setIsPageLoading(false);
                    }}
                    className={`w-full h-auto block select-text transition-opacity duration-200 ${isPageLoading ? 'opacity-40' : 'opacity-100'}`}
                    style={{ imageRendering: '-webkit-optimize-contrast' }}
                    loading="eager"
                  />

                  {isPageLoading && (
                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 backdrop-blur-xs flex items-center justify-center">
                      <OrbitingOrbLoader size="sm" state="searching" />
                    </div>
                  )}
                </div>

                {totalPages > 1 && (
                  <div className="my-4 px-3.5 py-1.5 rounded-full bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-color)] shadow-sm text-xs font-mono text-[var(--text-muted)] select-none">
                    Page {currentPage} of {totalPages}
                  </div>
                )}
              </div>
            ) : (
              <div 
                className="w-full p-6 sm:p-8 omni-prose"
                style={{ 
                  fontSize: `${(zoom / 100) * 0.95}rem`,
                }}
              >
                {isPdf && imgError && (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-xs text-[var(--text-muted)] flex items-center gap-2">
                    <span>Viewing verified document text stream</span>
                  </div>
                )}
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
});

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, FileText } from 'lucide-react';
import { DocumentItem } from '../../types/document';
import { api } from '../../services/api';

interface VisualPdfReaderProps {
  documents: DocumentItem[];
  selectedPdf: string;
  setSelectedPdf: (val: string) => void;
}

export const VisualPdfReader: React.FC<VisualPdfReaderProps> = ({
  documents,
  selectedPdf,
  setSelectedPdf,
}) => {
  const pdfDocs = documents.filter(d => d.filename.toLowerCase().endsWith('.pdf'));
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(100);

  useEffect(() => {
    if (pdfDocs.length > 0 && !selectedPdf) {
      setSelectedPdf(pdfDocs[0].filename);
    }
  }, [pdfDocs, selectedPdf, setSelectedPdf]);

  useEffect(() => {
    if (selectedPdf) {
      setCurrentPage(1);
      api.getPdfInfo(selectedPdf)
        .then(data => setTotalPages(data.total_pages || 1))
        .catch(() => setTotalPages(1));
    }
  }, [selectedPdf]);

  if (pdfDocs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[var(--bg-dark)] h-[calc(100vh-44px)]">
        <FileText size={48} className="text-[var(--text-dark)] mb-3" />
        <h2 className="text-base font-semibold text-[var(--text-main)] mb-1">No PDF documents in vault</h2>
        <p className="text-xs text-[var(--text-muted)] max-w-sm">
          Upload PDF files in the Knowledge Vault tab to view rendered pages and visual charts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-44px)] bg-[var(--bg-dark)] overflow-hidden">
      {/* Top PDF Navigation Bar */}
      <div className="h-12 px-6 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-card)] select-none">
        {/* PDF Document Selector */}
        <div className="flex items-center gap-3">
          <FileText size={16} className="text-[var(--accent-primary)]" />
          <select
            value={selectedPdf}
            onChange={(e) => setSelectedPdf(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-xs text-[var(--text-main)] outline-none max-w-xs font-medium cursor-pointer"
          >
            {pdfDocs.map(d => (
              <option key={d.filename} value={d.filename}>
                {d.filename} ({d.pages}p · {d.size_mb}MB)
              </option>
            ))}
          </select>
        </div>

        {/* Page Navigator & Zoom Controls */}
        <div className="flex items-center gap-3">
          {/* Pagination */}
          <div className="flex items-center gap-1.5 bg-[var(--bg-input)] px-2.5 py-1 rounded-lg border border-[var(--border-color)] text-xs">
            <button
              className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              title="Previous Page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="font-mono text-xs text-[var(--text-main)] px-1">
              {currentPage} / {totalPages}
            </span>
            <button
              className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              title="Next Page"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <button
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
              onClick={() => setZoom(prev => Math.min(200, prev + 20))}
              title="Zoom In"
            >
              <ZoomIn size={15} />
            </button>
            <span className="text-[11px] font-mono text-[var(--text-dark)] w-10 text-center">
              {zoom}%
            </span>
            <button
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
              onClick={() => setZoom(prev => Math.max(50, prev - 20))}
              title="Zoom Out"
            >
              <ZoomOut size={15} />
            </button>
          </div>

          <button
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] ml-1"
            onClick={() => window.open(api.getDownloadUrl(selectedPdf), '_blank')}
            title="Download PDF"
          >
            <Download size={15} />
          </button>
        </div>
      </div>

      {/* PDF Render Canvas */}
      <div className="flex-1 overflow-auto p-8 flex justify-center items-start bg-[var(--bg-sidebar)]">
        <div 
          className="transition-transform duration-200 origin-top shadow-2xl rounded-lg overflow-hidden border border-[var(--border-color)] bg-white"
          style={{ transform: `scale(${zoom / 100})` }}
        >
          <img
            src={api.getPdfPageImageUrl(selectedPdf, currentPage)}
            alt={`Page ${currentPage} of ${selectedPdf}`}
            className="max-w-4xl w-full block"
          />
        </div>
      </div>
    </div>
  );
};

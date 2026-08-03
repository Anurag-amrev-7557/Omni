import React, { useState } from 'react';
import { UploadCloud, RotateCw } from 'lucide-react';

interface VaultDropzoneProps {
  isUploading: boolean;
  onUpload: (files: FileList | File[]) => void;
}

export const VaultDropzone: React.FC<VaultDropzoneProps> = ({ isUploading, onUpload }) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);

  return (
    <div
      className={`border-2 border-dashed rounded-2xl p-7 text-center mb-7 transition-all cursor-pointer select-none ${
        isDragging 
          ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)]/30 scale-[0.99]' 
          : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--accent-primary)]/50'
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) onUpload(e.dataTransfer.files);
      }}
      onClick={() => document.getElementById('vault-file-upload-input')?.click()}
    >
      <input 
        type="file" 
        id="vault-file-upload-input" 
        multiple 
        onChange={(e) => e.target.files && onUpload(e.target.files)} 
        className="hidden" 
      />

      <div className="flex flex-col items-center gap-2 max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-input)] text-[var(--accent-primary)] border border-[var(--border-color)] mb-1">
          {isUploading ? <RotateCw size={22} className="spin-animation" /> : <UploadCloud size={22} />}
        </div>
        <h3 className="text-sm font-semibold text-[var(--text-main)]">
          {isUploading ? "Parsing, chunking, and generating vector embeddings..." : "Drag & drop documents here, or browse files"}
        </h3>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Files are automatically parsed with PyMuPDF, chunked into 300c child vectors, and mapped to 1500c parent blocks.
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-color)]">
            PDF Documents
          </span>
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-color)]">
            Markdown (.md)
          </span>
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-color)]">
            Plaintext (.txt)
          </span>
        </div>
      </div>
    </div>
  );
};

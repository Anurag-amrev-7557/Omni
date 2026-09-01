import React, { useState } from 'react';
import { X, Copy, Check, Share2 } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionTitle: string;
  showToast: (msg: string) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  sessionTitle,
  showToast,
}) => {
  const [copied, setCopied] = useState(false);
  const shareUrl = window.location.href;

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    showToast("Share link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm fade-in" 
      style={{ backgroundColor: 'var(--backdrop-color)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-[var(--accent-primary)]" />
            <h2 className="text-sm font-semibold text-[var(--text-main)]">Share Research Thread</h2>
          </div>
          <button className="text-[var(--text-muted)] hover:text-[var(--text-main)]" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)] mb-4">
          Share a snapshot of &ldquo;{sessionTitle || 'New chat'}&rdquo; with team members.
        </p>

        <div className="flex items-center gap-2 p-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] mb-4">
          <input
            type="text"
            readOnly
            value={shareUrl}
            className="flex-1 bg-transparent text-xs text-[var(--text-main)] outline-none truncate"
          />
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-hover)] transition-all flex-shrink-0"
            onClick={handleCopy}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy Link'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { Info, X } from 'lucide-react';

interface ToastProps {
  message: string;
  onClose?: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-[var(--bg-modal)] border border-[var(--border-color)] text-[var(--text-main)] shadow-2xl text-xs font-medium fade-in backdrop-blur-md max-w-md">
      <Info size={15} className="text-[var(--accent-primary)] flex-shrink-0" />
      <span className="leading-snug">{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="ml-1.5 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors rounded"
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};

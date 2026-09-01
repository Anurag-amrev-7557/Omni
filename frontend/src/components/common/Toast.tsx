import React from 'react';
import { Info } from 'lucide-react';

interface ToastProps {
  message: string;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--bg-modal)] border border-[var(--border-color)] text-[var(--text-main)] shadow-2xl text-xs font-medium fade-in backdrop-blur-md">
      <Info size={15} className="text-[var(--accent-primary)] flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
};

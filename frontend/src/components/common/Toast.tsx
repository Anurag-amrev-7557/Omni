import React from 'react';
import { Info, Globe, Database, Check, AlertCircle, Sparkles } from 'lucide-react';

interface ToastProps {
  message: string;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  if (!message) return null;

  const isWebSearchOn = message.toLowerCase().includes('web') && (message.toLowerCase().includes('enabled') || message.toLowerCase().includes('on'));
  const isWebSearchOff = message.toLowerCase().includes('vault') || (message.toLowerCase().includes('web') && message.toLowerCase().includes('disabled'));
  const isSuccess = message.toLowerCase().includes('copied') || message.toLowerCase().includes('saved') || message.toLowerCase().includes('thank you');
  const isError = message.toLowerCase().includes('error') || message.toLowerCase().includes('failed');

  // Strip emoji prefixes so clean SVG icons render consistently
  const cleanMessage = message.replace(/[🌐📁⚠️✨]/g, '').trim();

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-[var(--bg-modal)]/95 border border-[var(--border-color)] text-[var(--text-main)] shadow-[0_16px_36px_rgba(0,0,0,0.25)] text-xs font-medium fade-in backdrop-blur-xl select-none">
      {isWebSearchOn ? (
        <div className="w-5 h-5 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center flex-shrink-0">
          <Globe size={13} className="animate-[spin_10s_linear_infinite]" />
        </div>
      ) : isWebSearchOff ? (
        <div className="w-5 h-5 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center flex-shrink-0">
          <Database size={13} />
        </div>
      ) : isSuccess ? (
        <div className="w-5 h-5 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-shrink-0">
          <Check size={13} />
        </div>
      ) : isError ? (
        <div className="w-5 h-5 rounded-lg bg-red-500/15 text-red-400 flex items-center justify-center flex-shrink-0">
          <AlertCircle size={13} />
        </div>
      ) : (
        <div className="w-5 h-5 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center flex-shrink-0">
          <Sparkles size={13} />
        </div>
      )}
      <span className="text-[13px] font-medium text-[var(--text-main)] leading-tight">{cleanMessage}</span>
    </div>
  );
};

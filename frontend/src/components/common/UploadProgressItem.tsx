import React from 'react';
import { Loader2, CheckCircle, XCircle, Clock, X, RotateCcw } from 'lucide-react';
import { FormatBadge } from './FormatBadge';

interface UploadProgressItemProps {
  filename: string;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  progress: number;
  stage?: string;
  error?: string;
  onCancel?: () => void;
  onRetry?: () => void;
}

export const UploadProgressItem: React.FC<UploadProgressItemProps> = ({
  filename,
  status,
  progress,
  stage,
  error,
  onCancel,
  onRetry
}) => {
  const getStatusText = () => {
    if (stage) return stage;
    switch (status) {
      case 'uploading':
        return `Uploading (${progress}%)...`;
      case 'processing':
        return `Processing (${progress}%)...`;
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      default:
        return 'Pending';
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3.5 sm:px-4 sm:py-3 hover:bg-[var(--bg-hover)] transition-colors">
      {/* Top Row: Format Badge, Filename, Stage Pill, Percentage, Action */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <FormatBadge filename={filename} size="xs" />
          <span className="text-[13px] font-semibold text-[var(--text-main)] truncate max-w-xs sm:max-w-md" title={filename}>
            {filename}
          </span>
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          {/* Stage Status Pill */}
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 shadow-2xs">
            {status === 'completed' ? (
              <CheckCircle size={11} className="text-emerald-500" />
            ) : status === 'failed' ? (
              <XCircle size={11} className="text-red-500" />
            ) : (
              <Loader2 size={11} className="animate-spin text-[var(--accent-primary)]" />
            )}
            <span className="truncate max-w-[200px]">{getStatusText()}</span>
          </span>

          {/* Percentage */}
          <span className="font-mono text-[12px] font-semibold text-[var(--text-main)] min-w-[36px] text-right">
            {progress}%
          </span>

          {/* Retry Button */}
          {status === 'failed' && onRetry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              className="px-2 py-1 rounded-lg text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-subtle)] transition-colors cursor-pointer inline-flex items-center gap-1"
              title="Retry indexing"
            >
              <RotateCcw size={12} />
              <span>Retry</span>
            </button>
          )}

          {/* Cancel Button */}
          {onCancel && (status === 'uploading' || status === 'processing') && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              title="Cancel upload and rollback"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Progress Track (Delicate & Theme Accent Filled) */}
      <div className="w-full h-1.5 bg-[var(--bg-input)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${Math.max(3, progress)}%`,
            backgroundColor: status === 'failed' ? '#ef4444' : status === 'completed' ? '#10b981' : 'var(--accent-primary)',
          }}
        />
      </div>

      {/* Mobile Stage Text fallback */}
      <div className="flex sm:hidden items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span className="truncate">{getStatusText()}</span>
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-xs text-red-400 truncate">
          {error}
        </p>
      )}
    </div>
  );
};

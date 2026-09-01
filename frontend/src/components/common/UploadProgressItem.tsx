import React from 'react';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';

interface UploadProgressItemProps {
  filename: string;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  progress: number;
  stage?: string;
  error?: string;
}

export const UploadProgressItem: React.FC<UploadProgressItemProps> = ({
  filename,
  status,
  progress,
  stage,
  error
}) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'uploading':
      case 'processing':
        return <Loader2 size={14} className="animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle size={14} className="text-green-500" />;
      case 'failed':
        return <XCircle size={14} className="text-red-500" />;
      default:
        return <Clock size={14} className="text-gray-400" />;
    }
  };

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

  const getStatusColor = () => {
    switch (status) {
      case 'uploading':
        return 'bg-blue-500';
      case 'processing':
        return 'bg-purple-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)]">
      {/* Status Icon */}
      <div className="flex-shrink-0">
        {getStatusIcon()}
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-[var(--text-main)] truncate">
            {filename}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {getStatusText()}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-1.5 bg-[var(--bg-input)] rounded-full overflow-hidden">
          <div
            className={`h-full ${getStatusColor()} transition-all duration-300`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-xs text-red-400 mt-1 truncate">
            {error}
          </p>
        )}
      </div>

      {/* Progress Percentage */}
      <div className="flex-shrink-0 text-xs font-mono text-[var(--text-muted)]">
        {progress}%
      </div>
    </div>
  );
};

import React from 'react';

interface FormatBadgeProps {
  filename: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export const FormatBadge: React.FC<FormatBadgeProps> = ({ filename, size = 'md' }) => {
  const ext = filename.split('.').pop()?.toLowerCase() || 'txt';
  const isPdf = ext === 'pdf';
  const isMd = ext === 'md';

  const badgeSizeClasses = size === 'xs'
    ? 'px-2 py-0.5 text-[9.5px] font-bold h-[20px] rounded-lg tracking-wider'
    : size === 'sm' 
    ? 'w-7 h-7 text-[10.5px] rounded-lg font-bold' 
    : size === 'lg'
    ? 'w-10 h-10 text-xs rounded-xl font-bold'
    : 'w-8 h-8 text-xs rounded-xl font-bold';

  let styleVars = {
    backgroundColor: 'var(--badge-txt-bg)',
    color: 'var(--badge-txt-text)',
    borderColor: 'var(--badge-txt-border)',
  };

  if (isPdf) {
    styleVars = {
      backgroundColor: 'var(--badge-pdf-bg)',
      color: 'var(--badge-pdf-text)',
      borderColor: 'var(--badge-pdf-border)',
    };
  } else if (isMd) {
    styleVars = {
      backgroundColor: 'var(--badge-md-bg)',
      color: 'var(--badge-md-text)',
      borderColor: 'var(--badge-md-border)',
    };
  }

  return (
    <div 
      className={`inline-flex items-center justify-center font-bold uppercase tracking-wider border flex-shrink-0 leading-none transition-colors ${badgeSizeClasses}`}
      style={styleVars}
    >
      {ext}
    </div>
  );
};

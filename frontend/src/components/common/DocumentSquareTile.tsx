import React, { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../services/api';

interface DocumentSquareTileProps {
  filename: string;
  fileObject?: File;
  onRemove?: () => void;
  onClick?: () => void;
  size?: 'md' | 'lg';
}

export const DocumentSquareTile: React.FC<DocumentSquareTileProps> = ({
  filename,
  fileObject,
  onRemove,
  onClick,
  size = 'md',
}) => {
  const [imgError, setImgError] = useState(false);
  const ext = filename.split('.').pop()?.toLowerCase() || 'txt';
  const isPdf = ext === 'pdf';

  // Generate thumbnail URL for existing vault PDFs or object URL for local uploads
  const previewUrl = React.useMemo(() => {
    if (fileObject && fileObject.type.startsWith('image/')) {
      return URL.createObjectURL(fileObject);
    }
    if (isPdf && !fileObject) {
      return api.getPdfPageImageUrl(filename, 1);
    }
    return null;
  }, [filename, fileObject, isPdf]);

  const tileDim = size === 'lg' ? 'w-32 h-44' : 'w-28 h-36';
  const widthPx = size === 'lg' ? 128 : 112;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.();
  };

  return (
    <div 
      className="relative group select-none flex-shrink-0 origin-center"
      style={{ width: widthPx, maxWidth: widthPx }}
    >
      {/* Borderless Portrait Document Sheet Card */}
      <div 
        className={`${tileDim} rounded-2xl bg-white shadow-md hover:shadow-xl cursor-pointer overflow-hidden relative flex flex-col justify-start origin-center pop-in`}
        onClick={onClick}
        title={filename}
      >
        {/* Document Page Preview Canvas (100% Edge-to-Edge Coverage) */}
        {previewUrl && !imgError ? (
          <img 
            src={previewUrl} 
            alt={filename}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover object-top block"
            loading="lazy"
          />
        ) : (
          /* Realistic Mini Document Sheet Simulation for Markdown/Text/Fallback */
          <div className="w-full h-full p-3 bg-white flex flex-col gap-1.5 select-none overflow-hidden">
            {/* Document Header */}
            <div className="w-3/4 h-2 bg-zinc-800 rounded-sm mb-1 mt-0.5" />
            <div className="w-1/2 h-1 bg-zinc-400 rounded-xs mb-2" />
            {/* Body Skeleton Lines */}
            <div className="w-full h-0.5 bg-zinc-300 rounded-xs" />
            <div className="w-11/12 h-0.5 bg-zinc-300 rounded-xs" />
            <div className="w-4/5 h-0.5 bg-zinc-300 rounded-xs" />
            <div className="w-full h-0.5 bg-zinc-200 rounded-xs mt-1" />
            <div className="w-10/12 h-0.5 bg-zinc-200 rounded-xs" />
            <div className="w-full h-0.5 bg-zinc-200 rounded-xs" />
            <div className="w-3/4 h-0.5 bg-zinc-200 rounded-xs" />
            <div className="w-5/6 h-0.5 bg-zinc-200 rounded-xs" />
            <div className="w-4/5 h-0.5 bg-zinc-200 rounded-xs" />
          </div>
        )}

        {/* Floating Format Badge (Bottom-Left Corner) */}
        <div className="absolute bottom-2 left-2 z-10">
          <div className="px-2.5 py-1 rounded-lg bg-[#27272a]/95 text-white font-bold text-[10.5px] uppercase tracking-wider border border-white/20 shadow-md leading-none flex items-center gap-1">
            {ext}
          </div>
        </div>
      </div>

      {/* Floating Top-Right Corner Dismiss (X) Button (Scales in/out from zero on hover) */}
      {onRemove && (
        <button 
          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#18181b] border border-white/20 text-white hover:bg-red-500 hover:border-red-400 shadow-md flex items-center justify-center transition-all duration-200 ease-out origin-center cursor-pointer z-20 opacity-0 group-hover:opacity-100 scale-0 group-hover:scale-100"
          onClick={handleDismiss}
          title="Remove reference"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
};

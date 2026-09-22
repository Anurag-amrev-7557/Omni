import React from 'react';

interface CustomCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
  ariaLabel?: string;
}

export const CustomCheckbox: React.FC<CustomCheckboxProps> = ({
  checked,
  indeterminate = false,
  onChange,
  className = '',
  ariaLabel = 'Select item',
}) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center transition-all duration-200 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 ${
        checked || indeterminate
          ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)] shadow-xs scale-100'
          : 'bg-[var(--bg-input)]/80 border-[var(--border-input)] hover:border-[var(--accent-primary)]/80 hover:bg-[var(--bg-hover)]'
      } ${className}`}
    >
      {/* Crisp Checkmark SVG */}
      <svg
        className={`w-3 h-3 text-[var(--accent-contrast-text)] transition-all duration-200 ease-out transform ${
          checked && !indeterminate ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
        }`}
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="2.5 7.5 5.5 10.5 11.5 3.5" />
      </svg>

      {/* Indeterminate Horizontal Minus Bar */}
      {indeterminate && !checked && (
        <span className="w-2.5 h-[2px] bg-[var(--accent-contrast-text)] rounded-full transition-transform duration-200 transform scale-100 absolute" />
      )}
    </button>
  );
};

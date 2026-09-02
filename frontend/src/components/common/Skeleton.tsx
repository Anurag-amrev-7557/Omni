import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', style }) => {
  return (
    <div
      className={`omni-skeleton ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
};

import React from 'react';
import { ThinkingOrb, OrbState, OrbSize } from 'thinking-orbs';
import { useTheme } from '../../context/ThemeContext';
import { OrbStyle } from '../../types/theme';

export { ThinkingOrb };
export type { OrbState, OrbSize };

export interface OrbitingOrbLoaderProps {
  /** Hand-tuned animation state from thinking-orbs */
  state?: OrbState;
  /** Legacy or configured style key (mapped to state) */
  style?: OrbStyle;
  /** Size preset ('sm' | 'md' | 'lg' | 'xl') or numeric pixel size (20 | 32 | 64) */
  size?: 'sm' | 'md' | 'lg' | 'xl' | OrbSize | number;
  /** Optional ink color override (hex #rrggbb or rgb) */
  color?: string;
  /** Animation speed multiplier */
  speed?: number;
  /** Density multiplier for dots (default 1) */
  dots?: number;
  /** Radius multiplier for dots (default 1) */
  dotSize?: number;
  /** Optional theme override ('auto' | 'dark' | 'light') */
  theme?: 'auto' | 'dark' | 'light';
  /** Optional text status label */
  text?: string;
  /** Additional CSS class names */
  className?: string;
}

const LEGACY_STYLE_MAP: Record<string, OrbState> = {
  vortex: 'working',
  'vortex-pure': 'weaving',
  bands: 'solving',
  geodesic: 'connecting',
  pulse: 'breathing',
};

const VALID_STATES: Set<string> = new Set([
  'working',
  'searching',
  'solving',
  'listening',
  'connecting',
  'weaving',
  'composing',
  'breathing',
  'shaping',
]);

const resolveOrbState = (state?: OrbState, style?: OrbStyle, contextStyle?: OrbStyle): OrbState => {
  if (state && VALID_STATES.has(state)) {
    return state;
  }
  if (style) {
    if (VALID_STATES.has(style)) return style as OrbState;
    if (LEGACY_STYLE_MAP[style]) return LEGACY_STYLE_MAP[style];
  }
  if (contextStyle) {
    if (VALID_STATES.has(contextStyle)) return contextStyle as OrbState;
    if (LEGACY_STYLE_MAP[contextStyle]) return LEGACY_STYLE_MAP[contextStyle];
  }
  return 'searching';
};

const normalizeSize = (size: 'sm' | 'md' | 'lg' | 'xl' | OrbSize | number = 'md'): OrbSize => {
  if (typeof size === 'number') {
    if (size <= 26) return 20;
    if (size <= 48) return 32;
    return 64;
  }
  switch (size) {
    case 'sm':
      return 20;
    case 'md':
      return 32;
    case 'lg':
    case 'xl':
    default:
      return 64;
  }
};

export const OrbitingOrbLoader: React.FC<OrbitingOrbLoaderProps> = ({
  state,
  style,
  size = 'md',
  color,
  speed,
  dots,
  dotSize,
  theme,
  text,
  className = '',
}) => {
  const { currentConfig, orbStyle: contextOrbStyle } = useTheme();

  const resolvedState = resolveOrbState(state, style, contextOrbStyle);
  const orbSize = normalizeSize(size);
  const accent = color || currentConfig?.previewColors?.accent || '#da7756';
  const resolvedTheme = theme || (currentConfig?.category === 'Light' ? 'light' : 'dark');

  return (
    <div
      className={`inline-flex items-center justify-center gap-2.5 ${className}`}
      role="status"
      aria-label={text || `Loading (${resolvedState})`}
    >
      <div className="flex items-center justify-center shrink-0">
        <ThinkingOrb
          state={resolvedState}
          size={orbSize}
          color={accent}
          theme={resolvedTheme}
          speed={speed}
          dots={dots}
          dotSize={dotSize}
        />
      </div>
      {text && (
        <span className="text-xs text-[var(--text-muted)] animate-pulse font-sans tracking-wide select-none">
          {text}
        </span>
      )}
    </div>
  );
};

export default OrbitingOrbLoader;

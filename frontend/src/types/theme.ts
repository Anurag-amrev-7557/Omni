export type ThemeId = 
  | 'light' 
  | 'dark' 
  | 'matcha' 
  | 'matcha-dark' 
  | 'terracotta' 
  | 'terracotta-dark' 
  | 'nordic' 
  | 'nordic-dark' 
  | 'amber' 
  | 'amber-dark';

export type OrbStyle = 
  | 'vortex' 
  | 'vortex-pure' 
  | 'aurora'
  | 'bands' 
  | 'geodesic' 
  | 'gyroscope';

export interface OrbConfig {
  id: OrbStyle;
  name: string;
  badge: string;
  description: string;
}

export const ORB_PRESETS: Record<OrbStyle, OrbConfig> = {
  vortex: {
    id: 'vortex',
    name: '3D Celestial Nebula',
    badge: 'Chromatic',
    description: 'Dual-spiral logarithmic particle streams with organic micro-turbulence and luminous accent blooming',
  },
  aurora: {
    id: 'aurora',
    name: 'Liquid Aurora Ribbon',
    badge: 'Harmonic',
    description: 'Smooth flowing 3D harmonic energy wave with fluid gradient ribbon and luminous organic resonance',
  },
  'vortex-pure': {
    id: 'vortex-pure',
    name: 'Monochrome Stardust',
    badge: 'Minimal',
    description: 'Pure monochrome kinetic vortex streamlines with subtle micro-trails and smooth depth fading',
  },
  bands: {
    id: 'bands',
    name: 'Planetary Strata',
    badge: 'Kinetic',
    description: 'Layered horizontal latitude rows moving in counter-rotating orbital harmony',
  },
  geodesic: {
    id: 'geodesic',
    name: 'Fibonacci Golden Sphere',
    badge: 'Lattice',
    description: 'Golden-ratio spherical lattice with gentle organic breathing and exponential depth perspective',
  },
  gyroscope: {
    id: 'gyroscope',
    name: 'Quantum Orbital Rings',
    badge: 'Orbital',
    description: 'Ultra-thin precessing celestial orbital rings with soft glowing comet tracers and focal energy star',
  },
};

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  category: 'Light' | 'Dark';
  description: string;
  badge: string;
  previewColors: {
    bg: string;
    sidebar: string;
    accent: string;
    text: string;
  };
}

export const THEME_PRESETS: Record<ThemeId, ThemeConfig> = {
  // --- WARM CREAM & OBSIDIAN ---
  light: {
    id: 'light',
    name: 'Warm Cream Parchment',
    category: 'Light',
    description: 'Editorial ivory canvas with dark slate typography and terracotta accents',
    badge: 'Light',
    previewColors: {
      bg: '#fbfaf5',
      sidebar: '#f3efe6',
      accent: '#da7756',
      text: '#243e36',
    },
  },
  dark: {
    id: 'dark',
    name: 'Obsidian Charcoal',
    category: 'Dark',
    description: 'Deep carbon surfaces with warm terracotta accents (Default Dark)',
    badge: 'Dark',
    previewColors: {
      bg: '#161616',
      sidebar: '#131316',
      accent: '#da7756',
      text: '#f4f4f5',
    },
  },

  // --- MATCHA SUITE ---
  matcha: {
    id: 'matcha',
    name: 'Matcha Linen',
    category: 'Light',
    description: 'Soft organic herbal linen with deep cypress typography and matcha accents',
    badge: 'Light',
    previewColors: {
      bg: '#f5f7f2',
      sidebar: '#e9eee4',
      accent: '#588157',
      text: '#1b3223',
    },
  },
  'matcha-dark': {
    id: 'matcha-dark',
    name: 'Matcha Forest',
    category: 'Dark',
    description: 'Deep cypress and dark matcha night with bright sage accents and mint typography',
    badge: 'Dark',
    previewColors: {
      bg: '#14221a',
      sidebar: '#0e1a14',
      accent: '#84cc16',
      text: '#e6f4ea',
    },
  },

  // --- TERRACOTTA SUITE ---
  terracotta: {
    id: 'terracotta',
    name: 'Tuscan Terracotta',
    category: 'Light',
    description: 'Sun-baked clay and sand surfaces with espresso typography and rust accents',
    badge: 'Light',
    previewColors: {
      bg: '#fdf7f2',
      sidebar: '#f7ede4',
      accent: '#c85a32',
      text: '#341f17',
    },
  },
  'terracotta-dark': {
    id: 'terracotta-dark',
    name: 'Ember Terracotta',
    category: 'Dark',
    description: 'Warm clay ember ash surfaces with rich terracotta highlights and warm text',
    badge: 'Dark',
    previewColors: {
      bg: '#211714',
      sidebar: '#1a110e',
      accent: '#e07a5f',
      text: '#f7eee7',
    },
  },

  // --- NORDIC SUITE ---
  nordic: {
    id: 'nordic',
    name: 'Nordic Cashmere',
    category: 'Light',
    description: 'Muted cashmere sand with deep slate typography and glacial teal accents',
    badge: 'Light',
    previewColors: {
      bg: '#f7f7f8',
      sidebar: '#edeef0',
      accent: '#0f766e',
      text: '#1e293b',
    },
  },
  'nordic-dark': {
    id: 'nordic-dark',
    name: 'Nordic Fjord',
    category: 'Dark',
    description: 'Deep Arctic fjord night with glacial teal highlights and crisp silver text',
    badge: 'Dark',
    previewColors: {
      bg: '#0f172a',
      sidebar: '#090d19',
      accent: '#2dd4bf',
      text: '#f1f5f9',
    },
  },

  // --- VINTAGE AMBER SUITE ---
  amber: {
    id: 'amber',
    name: 'Vintage Sepia & Amber',
    category: 'Light',
    description: 'Antique archival parchment with bistre typography and warm amber highlights',
    badge: 'Light',
    previewColors: {
      bg: '#faf5ea',
      sidebar: '#f2e8d5',
      accent: '#d97706',
      text: '#382a1d',
    },
  },
  'amber-dark': {
    id: 'amber-dark',
    name: 'Dark Roast Amber',
    category: 'Dark',
    description: 'Deep roasted espresso surfaces with radiant golden amber accents',
    badge: 'Dark',
    previewColors: {
      bg: '#1b140e',
      sidebar: '#140e0a',
      accent: '#f59e0b',
      text: '#f9f1e8',
    },
  },
};

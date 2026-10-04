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

import type { OrbState } from 'thinking-orbs';

export type OrbStyle = 
  | OrbState 
  | 'vortex' 
  | 'vortex-pure' 
  | 'bands' 
  | 'geodesic' 
  | 'pulse';

export interface OrbConfig {
  id: OrbStyle;
  name: string;
  badge: string;
  description: string;
}

export const ORB_PRESETS: Record<string, OrbConfig> = {
  searching: {
    id: 'searching',
    name: 'Globe Scan',
    badge: 'Search',
    description: 'A scan meridian sweeps across a dotted 3D globe',
  },
  working: {
    id: 'working',
    name: 'Orbital Path',
    badge: 'Process',
    description: 'Particles circulating along tilted orbital paths',
  },
  solving: {
    id: 'solving',
    name: 'Quantum Scramble',
    badge: 'Reasoning',
    description: 'Bands scramble in quarter turns, then click back into place',
  },
  connecting: {
    id: 'connecting',
    name: 'Constellation Mesh',
    badge: 'Network',
    description: 'Constellation wires itself with packets running along edges',
  },
  weaving: {
    id: 'weaving',
    name: 'Helix Plait',
    badge: 'Synthesis',
    description: 'Three fluid strands plait continuously around the sphere',
  },
  composing: {
    id: 'composing',
    name: 'Undulating Sash',
    badge: 'Creative',
    description: 'A luminous ribbon undulating in a multi-band 3D sash',
  },
  breathing: {
    id: 'breathing',
    name: 'Core Resonance',
    badge: 'Ambient',
    description: 'A face-on luminous dotted ring slowly breathing and morphing',
  },
  listening: {
    id: 'listening',
    name: 'Harmonic Waveform',
    badge: 'Audio',
    description: 'Harmonic waves rolling across latitude rings',
  },
  shaping: {
    id: 'shaping',
    name: 'Polymorphic Shift',
    badge: 'Geometry',
    description: 'Dotted outlines morphing smoothly circle → triangle → square',
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
  light: {
    id: 'light',
    name: 'Warm Cream Parchment',
    category: 'Light',
    description: 'Editorial ivory canvas with dark slate typography and terracotta accents',
    badge: 'Light',
    previewColors: {
      bg: '#fbfaf5',
      sidebar: '#f3efe6',
      accent: '#b84c24',
      text: '#1c1a17',
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

  matcha: {
    id: 'matcha',
    name: 'Matcha Linen',
    category: 'Light',
    description: 'Soft organic herbal linen with deep cypress typography and matcha accents',
    badge: 'Light',
    previewColors: {
      bg: '#f5f7f2',
      sidebar: '#e9eee4',
      accent: '#3e6b43',
      text: '#14261b',
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

  terracotta: {
    id: 'terracotta',
    name: 'Tuscan Terracotta',
    category: 'Light',
    description: 'Sun-baked clay and sand surfaces with espresso typography and rust accents',
    badge: 'Light',
    previewColors: {
      bg: '#fdf7f2',
      sidebar: '#f7ede4',
      accent: '#b44822',
      text: '#2a1610',
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
      text: '#0f172a',
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

  amber: {
    id: 'amber',
    name: 'Vintage Sepia & Amber',
    category: 'Light',
    description: 'Antique archival parchment with bistre typography and warm amber highlights',
    badge: 'Light',
    previewColors: {
      bg: '#faf5ea',
      sidebar: '#f2e8d5',
      accent: '#a15504',
      text: '#261a10',
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

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  chatCount: number;
  createdAt: string;
  isDefault?: boolean;
  color?: string;
  icon?: string;
}

export const INITIAL_PROJECTS: ProjectItem[] = [
  {
    id: 'default-vault',
    name: 'Primary Knowledge Base',
    description: 'Main workspace collection containing indexed research papers, PDFs, notes, and technical documentation.',
    documentCount: 8,
    chatCount: 14,
    createdAt: '2026-08-15',
    isDefault: true,
    color: '#da7756',
  },
  {
    id: 'financial-reports',
    name: 'Financial & Market Intelligence',
    description: 'Quarterly earnings reports, macro summaries, revenue forecasts, and financial transcripts.',
    documentCount: 4,
    chatCount: 6,
    createdAt: '2026-08-28',
    color: '#588157',
  },
  {
    id: 'technical-specs',
    name: 'Architecture & System Design',
    description: 'Vector pipeline benchmarks, hybrid BM25 + dense retrieval specs, and API schemas.',
    documentCount: 6,
    chatCount: 9,
    createdAt: '2026-08-30',
    color: '#0f766e',
  },
];

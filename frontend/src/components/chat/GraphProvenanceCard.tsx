import React, { useState } from 'react';
import { GitFork, ChevronDown, ChevronUp, ExternalLink, ArrowRight } from 'lucide-react';
import { GraphHopTrace } from '../../types/graph';

interface GraphProvenanceCardProps {
  provenance: GraphHopTrace[];
  onInspectDoc?: (doc: { filename: string; page?: number; content?: string }) => void;
}

export const GraphProvenanceCard: React.FC<GraphProvenanceCardProps> = ({
  provenance,
  onInspectDoc,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (!provenance || provenance.length === 0) return null;

  return (
    <div className="mt-2.5 border border-[var(--border-color)] rounded-2xl bg-[var(--bg-card)] p-3 shadow-xs fade-in">
      <div
        className="flex items-center justify-between cursor-pointer text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] select-none transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <GitFork size={14} className="text-purple-500" />
          <span>Multi-Hop Graph Reasoning Path ({provenance.length} hops)</span>
        </div>
        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <span className="text-[11px] font-normal font-mono">
            {isOpen ? 'Collapse' : 'Expand'}
          </span>
          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {isOpen && (
        <div className="mt-2.5 pt-2.5 border-t border-[var(--border-color)] space-y-2">
          {provenance.map((hop, idx) => (
            <div
              key={idx}
              className="p-2.5 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-xs flex flex-col gap-1.5 shadow-2xs"
            >
              <div className="flex items-center justify-between gap-2">
                {/* Visual Hop Chain: Source ─[RELATION]─> Target */}
                <div className="flex items-center gap-1.5 flex-wrap font-mono text-[11.5px]">
                  <span className="font-bold text-[var(--text-main)] px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                    {hop.source}
                  </span>
                  <ArrowRight size={12} className="text-[var(--text-muted)]" />
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-semibold text-[10.5px]">
                    {hop.relation}
                  </span>
                  <ArrowRight size={12} className="text-[var(--text-muted)]" />
                  <span className="font-bold text-[var(--text-main)] px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                    {hop.target}
                  </span>
                </div>

                {hop.source_doc && onInspectDoc && (
                  <button
                    type="button"
                    onClick={() => onInspectDoc({ filename: hop.source_doc, page: hop.page, content: hop.snippet })}
                    className="flex items-center gap-1 text-[11px] text-[var(--accent-primary)] hover:underline flex-shrink-0 cursor-pointer"
                  >
                    <ExternalLink size={11} />
                    <span>p. {hop.page}</span>
                  </button>
                )}
              </div>

              {hop.description && (
                <p className="text-[11.5px] text-[var(--text-muted)] italic pl-2 border-l-2 border-purple-500/40">
                  {hop.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

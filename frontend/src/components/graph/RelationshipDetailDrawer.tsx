import React from 'react';
import { X, ExternalLink } from 'lucide-react';
import { GraphLink, GraphNode } from '../../types/graph';

interface RelationshipDetailDrawerProps {
  link: GraphLink | null;
  allNodes: GraphNode[];
  onClose: () => void;
  onSelectNode: (node: GraphNode) => void;
  onInspectDoc?: (doc: { filename: string; page?: number; content?: string }) => void;
}

export const RelationshipDetailDrawer: React.FC<RelationshipDetailDrawerProps> = ({
  link,
  allNodes,
  onClose,
  onSelectNode,
  onInspectDoc,
}) => {
  if (!link) return null;

  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const srcId = typeof link.source === 'object' ? (link.source as any).id : String(link.source);
  const tgtId = typeof link.target === 'object' ? (link.target as any).id : String(link.target);
  const srcNode = nodeMap.get(srcId);
  const tgtNode = nodeMap.get(tgtId);

  const srcName = srcNode?.name || 'Source';
  const tgtName = tgtNode?.name || 'Target';
  const relType = (link.type || 'RELATED_TO').toUpperCase().trim();

  return (
    <div className="absolute top-5 right-5 w-88 sm:w-96 max-w-[calc(100vw-40px)] max-h-[calc(100%-40px)] bg-[var(--bg-card)]/98 backdrop-blur-2xl border border-[var(--border-color)] rounded-2xl shadow-2xl z-30 flex flex-col overflow-hidden fade-in select-text animate-in slide-in-from-right-3 duration-150">
      {/* Header with seamless fade merge */}
      <div className="relative px-6 pt-5 pb-2.5 flex items-center justify-between gap-3 bg-[var(--bg-card)] z-10">
        <h3 className="text-base sm:text-lg font-bold text-[var(--text-main)] tracking-tight">
          Relationship
        </h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          title="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* Soft Gradient Fade Merge Boundary */}
      <div className="h-5 -mt-1 bg-gradient-to-b from-[var(--bg-card)] via-[var(--bg-card)]/60 to-transparent pointer-events-none z-10" />

      {/* Auto-Height Content bounded within screen viewport */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-0 space-y-4 text-xs">
        {/* Top Relation Card */}
        <div className="p-3.5 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[13px] text-[var(--text-main)] leading-relaxed shadow-2xs">
          <span 
            className="font-bold text-[var(--accent-primary)] hover:underline cursor-pointer"
            onClick={() => srcNode && onSelectNode(srcNode)}
          >
            {srcName}
          </span>
          <span className="text-[var(--text-muted)] mx-2 font-mono">→</span>
          <span className="px-2 py-0.5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[10.5px] font-bold">
            {relType}
          </span>
          <span className="text-[var(--text-muted)] mx-2 font-mono">→</span>
          <span 
            className="font-bold text-[var(--accent-primary)] hover:underline cursor-pointer"
            onClick={() => tgtNode && onSelectNode(tgtNode)}
          >
            {tgtName}
          </span>
        </div>

        {/* Key-Value Metadata Grid */}
        <div className="grid grid-cols-[75px_1fr] gap-y-3.5 gap-x-3 text-[13.5px] items-baseline">
          <div className="text-[var(--text-muted)] font-medium">UUID:</div>
          <div className="text-[var(--text-muted)] font-mono text-[12px] break-all select-all">
            {link.id || `${srcId}-${tgtId}`}
          </div>

          <div className="text-[var(--text-muted)] font-medium">Label:</div>
          <div className="text-[var(--text-main)] font-bold font-mono text-[12.5px]">{relType}</div>

          <div className="text-[var(--text-muted)] font-medium">Type:</div>
          <div className="text-[var(--text-main)] font-mono font-medium text-[12.5px]">{relType}</div>

          <div className="text-[var(--text-muted)] font-medium">Fact:</div>
          <div className="text-[var(--text-main)] text-[13px] leading-relaxed">
            {link.description || link.snippet || `Relationship indicating ${srcName} ${relType.toLowerCase().replace(/_/g, ' ')} ${tgtName}.`}
          </div>
        </div>

        {/* Episodes / Provenance Section */}
        <div className="pt-3.5 border-t border-[var(--border-color)] space-y-2">
          <div className="text-[13.5px] font-bold text-[var(--text-main)] mb-1.5">Episodes:</div>
          <div className="p-2 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] font-mono text-[11.5px] text-[var(--text-muted)] break-all">
            {link.source_doc ? `doc-${link.source_doc}` : link.id || 'episode-0527f080-4dbc-4b5d-98d5'}
          </div>

          {link.source_doc && (
            <div className="flex items-center justify-between p-2 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[12px]">
              <span className="truncate max-w-[220px] font-medium">📄 {link.source_doc} (p. {link.page_num || 1})</span>
              {onInspectDoc && (
                <button
                  type="button"
                  onClick={() => onInspectDoc({ filename: link.source_doc, page: link.page_num || 1, content: link.snippet || link.description })}
                  className="text-[var(--accent-primary)] hover:underline flex items-center gap-1 text-[11.5px] font-semibold cursor-pointer ml-2"
                >
                  <ExternalLink size={12} />
                  <span>Inspect</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div className="pt-3.5 border-t border-[var(--border-color)] grid grid-cols-[85px_1fr] gap-y-2.5 gap-x-3 text-[12.5px]">
          <div className="text-[var(--text-muted)]">Created:</div>
          <div className="text-[var(--text-main)] font-medium">Feb 11, 2026, 8:03 AM</div>

          <div className="text-[var(--text-muted)]">Valid From:</div>
          <div className="text-[var(--text-main)] font-medium">Feb 11, 2026, 8:03 AM</div>
        </div>
      </div>
    </div>
  );
};

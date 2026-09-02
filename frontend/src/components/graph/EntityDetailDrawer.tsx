import React from 'react';
import { X, ExternalLink } from 'lucide-react';
import { GraphNode, GraphLink } from '../../types/graph';
import { getNodeStyle } from './KnowledgeGraphView';

interface EntityDetailDrawerProps {
  entity: GraphNode | null;
  links: GraphLink[];
  allNodes: GraphNode[];
  onClose: () => void;
  onSelectNode: (node: GraphNode) => void;
  onInspectDoc?: (doc: { filename: string; page?: number; content?: string }) => void;
}

export const EntityDetailDrawer: React.FC<EntityDetailDrawerProps> = ({
  entity,
  links,
  allNodes,
  onClose,
  onSelectNode,
  onInspectDoc,
}) => {
  if (!entity) return null;

  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const connectedLinks = links.filter(l => {
    const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
    const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;
    return srcId === entity.id || tgtId === entity.id;
  });

  const nodeStyle = getNodeStyle(entity.type, entity.community_id);
  const uniqueDocs = Array.from(new Set((entity.source_docs || []).filter(Boolean)));

  return (
    <div className="absolute top-5 right-5 w-88 sm:w-96 max-w-[calc(100vw-40px)] max-h-[calc(100%-40px)] bg-[var(--bg-card)]/98 backdrop-blur-2xl border border-[var(--border-color)] rounded-2xl shadow-2xl z-30 flex flex-col overflow-hidden fade-in select-text animate-in slide-in-from-right-3 duration-150">
      {/* Header with seamless fade merge */}
      <div className="relative px-6 pt-5 pb-2.5 flex items-center justify-between gap-3 bg-[var(--bg-card)] z-10">
        <h3 className="text-base sm:text-lg font-bold text-[var(--text-main)] tracking-tight">
          Node Details
        </h3>
        <div className="flex items-center gap-2.5">
          <span 
            className="px-3.5 py-1 rounded-full text-white text-xs font-semibold shadow-xs"
            style={{ backgroundColor: nodeStyle.bg }}
          >
            {entity.type || 'Entity'}
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Soft Gradient Fade Merge Boundary */}
      <div className="h-5 -mt-1 bg-gradient-to-b from-[var(--bg-card)] via-[var(--bg-card)]/60 to-transparent pointer-events-none z-10" />

      {/* Auto-Height Content (Bounded within screen viewport, scrollable) */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-0 space-y-4 text-xs">
        {/* Key-Value Metadata Grid (Image 3 Match) */}
        <div className="grid grid-cols-[75px_1fr] gap-y-3.5 gap-x-3 text-[13.5px] items-baseline">
          <div className="text-[var(--text-muted)] font-medium">Name:</div>
          <div className="text-[var(--text-main)] font-bold text-[14px] break-words">{entity.name}</div>

          <div className="text-[var(--text-muted)] font-medium">UUID:</div>
          <div className="text-[var(--text-muted)] font-mono text-[12px] break-all select-all">{entity.id}</div>

          <div className="text-[var(--text-muted)] font-medium">Created:</div>
          <div className="text-[var(--text-main)] font-medium">Feb 11, 2026, 8:03 AM</div>
        </div>

        {/* Properties Section (Image 3 Match) */}
        <div className="pt-3.5 border-t border-[var(--border-color)] space-y-2">
          <div className="text-[13.5px] font-bold text-[var(--text-main)]">Properties:</div>
          <div className="grid grid-cols-[100px_1fr] gap-y-2 gap-x-3 text-[13px] items-baseline">
            <div className="text-[var(--text-muted)]">degree:</div>
            <div className="text-[var(--text-main)] font-mono font-semibold">{entity.degree || connectedLinks.length}</div>

            <div className="text-[var(--text-muted)]">pagerank:</div>
            <div className="text-[var(--text-main)] font-mono font-semibold">{(entity.pagerank || 1.0).toFixed(2)}</div>

            {uniqueDocs.length > 0 && (
              <>
                <div className="text-[var(--text-muted)]">source_doc:</div>
                <div className="text-[var(--text-main)] truncate max-w-[200px]" title={uniqueDocs.join(', ')}>
                  {uniqueDocs.join(', ')}
                </div>
              </>
            )}
          </div>

          {/* Inspect Doc Action Button */}
          {uniqueDocs.length > 0 && onInspectDoc && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onInspectDoc({ filename: uniqueDocs[0], content: entity.description })}
                className="w-full p-2.5 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:border-[var(--accent-primary)]/40 hover:text-[var(--accent-primary)] text-left transition-all flex items-center justify-between text-[12px] font-medium text-[var(--text-main)] cursor-pointer group shadow-2xs"
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  <ExternalLink size={13} className="text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] flex-shrink-0" />
                  <span className="truncate">Inspect Document ({uniqueDocs[0]})</span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Summary Section (Image 3 Match) */}
        <div className="pt-3.5 border-t border-[var(--border-color)] space-y-1.5">
          <div className="text-[13.5px] font-bold text-[var(--text-main)]">Summary:</div>
          <p className="text-[13px] text-[var(--text-main)] leading-relaxed font-normal">
            {entity.description || `Extracted entity representing "${entity.name}" across knowledge base.`}
          </p>
        </div>

        {/* Labels Section (Image 3 Match) */}
        <div className="pt-3.5 border-t border-[var(--border-color)] space-y-2">
          <div className="text-[13.5px] font-bold text-[var(--text-main)]">Labels:</div>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 rounded-full bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[12px] font-semibold text-[var(--text-main)]">
              {entity.type || 'Entity'}
            </span>
            <span className="px-3 py-1 rounded-full bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[12px] font-semibold text-[var(--text-muted)] font-mono">
              Comm #{entity.community_id}
            </span>
            {(entity.aliases || []).map((alias, idx) => (
              <span key={idx} className="px-3 py-1 rounded-full bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[12px] font-medium text-[var(--text-main)]">
                {alias}
              </span>
            ))}
          </div>
        </div>

        {/* Connected Relationships Section (Image 3 Match) */}
        {connectedLinks.length > 0 && (
          <div className="pt-3.5 border-t border-[var(--border-color)] space-y-2.5 pb-1">
            <div className="text-[13.5px] font-bold text-[var(--text-main)] flex items-center justify-between">
              <span>Connected Relationships:</span>
              <span className="text-xs text-[var(--text-muted)] font-mono font-bold">{connectedLinks.length}</span>
            </div>

            <div className="space-y-2">
              {connectedLinks.map((link) => {
                const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
                const isOutgoing = srcId === entity.id;
                const targetNode = nodeMap.get(isOutgoing ? (typeof link.target === 'object' ? (link.target as any).id : link.target) : srcId);

                return (
                  <div
                    key={link.id}
                    onClick={() => targetNode && onSelectNode(targetNode)}
                    className="p-3.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] hover:border-[var(--accent-primary)]/40 hover:bg-[var(--bg-hover)] transition-all cursor-pointer group shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <span className="px-2 py-0.5 rounded bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[10.5px] font-bold">
                        {link.type}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)] font-mono">
                        {isOutgoing ? 'outgoing ➔' : 'incoming ⬅'}
                      </span>
                    </div>
                    <div className="font-bold text-[13.5px] text-[var(--text-main)] group-hover:text-[var(--accent-primary)] transition-colors truncate">
                      {targetNode?.name || 'Entity'}
                    </div>
                    {link.description && (
                      <div className="text-[12px] text-[var(--text-muted)] mt-1 line-clamp-2 leading-relaxed">
                        {link.description}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import React from 'react';
import { X, ExternalLink, GitBranch, Layers, BookOpen, Share2, Tag } from 'lucide-react';
import { GraphNode, GraphLink } from '../../types/graph';

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

  // Filter connected links
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const connectedLinks = links.filter(l => {
    const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
    const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;
    return srcId === entity.id || tgtId === entity.id;
  });

  return (
    <div className="absolute top-4 right-4 bottom-4 w-80 sm:w-96 bg-[var(--bg-card)]/95 backdrop-blur-xl border border-[var(--border-color)] rounded-2xl shadow-2xl z-30 flex flex-col overflow-hidden fade-in">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-color)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[11px] font-semibold">
              {entity.type || 'Concept'}
            </span>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              Comm. #{entity.community_id}
            </span>
          </div>
          <h3 className="text-base font-bold text-[var(--text-main)] truncate" title={entity.name}>
            {entity.name}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content Scroll */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Description */}
        {entity.description && (
          <div className="p-3 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)]">
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
              Description
            </div>
            <p className="text-[12.5px] text-[var(--text-main)] leading-relaxed">
              {entity.description}
            </p>
          </div>
        )}

        {/* Graph Metrics */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] flex items-center gap-2.5">
            <Share2 size={16} className="text-[var(--accent-primary)]" />
            <div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">Degree</div>
              <div className="text-sm font-bold text-[var(--text-main)] font-mono">{entity.degree || connectedLinks.length}</div>
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] flex items-center gap-2.5">
            <GitBranch size={16} className="text-purple-500" />
            <div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">PageRank</div>
              <div className="text-sm font-bold text-[var(--text-main)] font-mono">{(entity.pagerank || 1.0).toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Synonyms & Aliases */}
        {entity.aliases && entity.aliases.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
              <Tag size={12} />
              <span>Synonyms & Aliases</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {entity.aliases.map((alias, idx) => (
                <span key={idx} className="px-2 py-0.5 rounded-md bg-[var(--bg-hover)] border border-[var(--border-color)] text-[11px] text-[var(--text-main)]">
                  {alias}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Connected Graph Relationships */}
        <div>
          <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider flex items-center gap-1.5">
            <Layers size={12} />
            <span>Connected Edges ({connectedLinks.length})</span>
          </div>

          <div className="space-y-2">
            {connectedLinks.map((link) => {
              const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
              const isOutgoing = srcId === entity.id;
              const targetNode = nodeMap.get(isOutgoing ? (typeof link.target === 'object' ? (link.target as any).id : link.target) : srcId);

              return (
                <div
                  key={link.id}
                  className="p-2.5 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:border-[var(--accent-primary)]/40 transition-all cursor-pointer group"
                  onClick={() => targetNode && onSelectNode(targetNode)}
                >
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[10px] font-bold">
                      {link.type}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {isOutgoing ? 'outgoing ➔' : 'incoming ⬅'}
                    </span>
                  </div>
                  <div className="font-semibold text-xs text-[var(--text-main)] group-hover:text-[var(--accent-primary)] transition-colors">
                    {targetNode?.name || 'Entity'}
                  </div>
                  {link.description && (
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">
                      {link.description}
                    </div>
                  )}
                  {link.source_doc && (
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                      <span>📄 {link.source_doc} (p. {link.page_num || 1})</span>
                      {onInspectDoc && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectDoc({ filename: link.source_doc, page: link.page_num || 1, content: link.snippet });
                          }}
                          className="text-[var(--accent-primary)] hover:underline flex items-center gap-0.5"
                        >
                          <ExternalLink size={10} />
                          <span>View</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Source Documents */}
        {entity.source_docs && entity.source_docs.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen size={12} />
              <span>Extracted From</span>
            </div>
            <div className="space-y-1">
              {entity.source_docs.map((doc, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-hover)] text-[11px] text-[var(--text-main)]">
                  <span className="truncate">{doc}</span>
                  {onInspectDoc && (
                    <button
                      type="button"
                      onClick={() => onInspectDoc({ filename: doc, content: entity.description })}
                      className="text-[var(--accent-primary)] hover:underline flex items-center gap-0.5 flex-shrink-0"
                    >
                      <ExternalLink size={11} />
                      <span>Inspect</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

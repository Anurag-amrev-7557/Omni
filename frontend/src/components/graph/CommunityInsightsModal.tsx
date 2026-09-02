import React from 'react';
import { X, Sparkles, Network, CheckCircle2, ChevronRight } from 'lucide-react';
import { GraphCommunity } from '../../types/graph';

interface CommunityInsightsModalProps {
  isOpen: boolean;
  communities: GraphCommunity[];
  onClose: () => void;
  onSelectCommunity?: (communityId: number) => void;
}

export const CommunityInsightsModal: React.FC<CommunityInsightsModalProps> = ({
  isOpen,
  communities,
  onClose,
  onSelectCommunity,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm fade-in">
      <div className="w-full max-w-3xl max-h-[85vh] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--text-main)]">
                Hierarchical Community Macro-Insights
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Leiden & Louvain modularity clusters synthesized across Knowledge Vault documents
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* List of Communities */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {communities.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              <Network size={36} className="mx-auto mb-2 text-[var(--text-muted)] opacity-50" />
              <p>No community clusters detected yet. Index documents to auto-discover semantic themes.</p>
            </div>
          ) : (
            communities.map((comm) => (
              <div
                key={comm.id}
                className="p-4 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:border-[var(--accent-primary)]/40 transition-all shadow-xs"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-xs font-bold">
                      Cluster #{comm.id}
                    </span>
                    <h3 className="font-bold text-sm text-[var(--text-main)]">
                      {comm.title}
                    </h3>
                  </div>

                  {onSelectCommunity && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectCommunity(comm.id);
                        onClose();
                      }}
                      className="flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline flex-shrink-0"
                    >
                      <span>Highlight</span>
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>

                {/* Summary */}
                {comm.summary && (
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-line mb-3">
                    {comm.summary}
                  </p>
                )}

                {/* Key Entities */}
                {comm.key_entities && comm.key_entities.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[var(--border-color)]">
                    <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] mr-1">
                      Key Entities:
                    </span>
                    {comm.key_entities.map((k, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-[var(--bg-card)] border border-[var(--border-color)] text-[11px] font-medium text-[var(--text-main)]"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-color)] bg-[var(--bg-card)] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>{communities.length} semantic community clusters detected</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[var(--accent-primary)] text-white font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

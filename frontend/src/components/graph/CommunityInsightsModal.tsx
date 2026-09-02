import React, { useState, useMemo } from 'react';
import { X, Sparkles, Network, ChevronRight, Search, Layers } from 'lucide-react';
import { GraphCommunity } from '../../types/graph';

interface CommunityInsightsModalProps {
  isOpen: boolean;
  communities: GraphCommunity[];
  onClose: () => void;
  onSelectCommunity?: (communityId: number) => void;
}

function renderFormattedText(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-[var(--text-main)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

const FormattedInsightContent: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  return (
    <div className="space-y-2.5 text-[12.5px] leading-relaxed">
      {lines.map((line, idx) => {
        // Bullet item
        if (line.startsWith('- ') || line.startsWith('• ') || line.startsWith('* ')) {
          const bulletText = line.replace(/^[-•*]\s+/, '');
          return (
            <div key={idx} className="flex items-start gap-2.5 pl-1 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] mt-2 flex-shrink-0" />
              <span className="flex-1 text-[var(--text-main)]/90 text-[12px] leading-relaxed">
                {renderFormattedText(bulletText)}
              </span>
            </div>
          );
        }

        // Executive Theme or Section Heading
        if (line.toLowerCase().startsWith('**executive theme:**') || line.toLowerCase().startsWith('executive theme:')) {
          return (
            <div key={idx} className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[12px] text-[var(--text-main)] leading-relaxed">
              <span className="font-bold text-[var(--accent-primary)] mr-1.5 uppercase tracking-wide text-[11px]">
                Executive Theme:
              </span>
              {renderFormattedText(line.replace(/^\*\*executive theme:\*\*\s*/i, '').replace(/^executive theme:\s*/i, ''))}
            </div>
          );
        }

        if (line.toLowerCase().startsWith('**key insights:**') || line.toLowerCase().startsWith('key insights:')) {
          return (
            <div key={idx} className="pt-2 font-bold text-xs uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
              <span>Key Insights</span>
            </div>
          );
        }

        return (
          <p key={idx} className="text-[var(--text-main)]/90 text-[12px] leading-relaxed">
            {renderFormattedText(line)}
          </p>
        );
      })}
    </div>
  );
};

export const CommunityInsightsModal: React.FC<CommunityInsightsModalProps> = ({
  isOpen,
  communities,
  onClose,
  onSelectCommunity,
}) => {
  const [filterQuery, setFilterQuery] = useState('');

  const filteredCommunities = useMemo(() => {
    if (!filterQuery.trim()) return communities;
    const q = filterQuery.toLowerCase();
    return communities.filter(c => 
      c.title.toLowerCase().includes(q) ||
      (c.summary && c.summary.toLowerCase().includes(q)) ||
      (c.key_entities && c.key_entities.some(e => e.toLowerCase().includes(q)))
    );
  }, [communities, filterQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm fade-in">
      <div className="w-full max-w-3xl max-h-[88vh] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-[var(--border-color)] flex items-center justify-between gap-4 bg-[var(--bg-card)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center flex-shrink-0 shadow-xs">
              <Sparkles size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-[var(--text-main)] tracking-tight">
                  Community Macro-Insights
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[11px] font-bold">
                  {communities.length} Clusters
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Modularity clusters synthesized across your Knowledge Vault documents
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            title="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search / Filter Toolbar inside modal */}
        {communities.length > 2 && (
          <div className="px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/60 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Filter insights by title, theme, or entity..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-xs text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
          </div>
        )}

        {/* List of Communities */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {filteredCommunities.length === 0 ? (
            <div className="py-16 text-center text-xs text-[var(--text-muted)]">
              <Network size={36} className="mx-auto mb-3 text-[var(--text-muted)] opacity-40" />
              <p className="font-medium text-sm text-[var(--text-main)] mb-1">No community clusters match your search</p>
              <p className="text-[var(--text-muted)]">Try clearing your filter or index more documents to extract themes.</p>
            </div>
          ) : (
            filteredCommunities.map((comm) => (
              <div
                key={comm.id}
                className="p-5 rounded-2xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:border-[var(--accent-primary)]/40 transition-all shadow-xs space-y-3"
              >
                {/* Cluster Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[11px] font-bold">
                      Cluster #{comm.id}
                    </span>
                    <h3 className="font-bold text-sm sm:text-base text-[var(--text-main)] tracking-tight">
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
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-[var(--accent-primary)]/40 hover:text-[var(--accent-primary)] text-xs font-semibold text-[var(--text-muted)] transition-all flex-shrink-0 cursor-pointer shadow-xs"
                    >
                      <span>Highlight in Graph</span>
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>

                {/* Formatted Markdown Body */}
                {comm.summary && (
                  <div className="pt-1">
                    <FormattedInsightContent content={comm.summary} />
                  </div>
                )}

                {/* Key Entities */}
                {comm.key_entities && comm.key_entities.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-[var(--border-color)]">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider mr-1">
                      Key Entities:
                    </span>
                    {comm.key_entities.map((k, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[11px] font-medium text-[var(--text-main)] shadow-2xs"
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
        <div className="px-5 py-4 border-t border-[var(--border-color)] bg-[var(--bg-card)] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-[var(--accent-primary)]" />
            <span>{communities.length} semantic community clusters detected</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-[var(--accent-primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

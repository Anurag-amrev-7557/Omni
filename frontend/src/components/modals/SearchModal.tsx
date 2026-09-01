import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, X, MessageSquare, ArrowRight, FileText, 
  Settings, Plus, Database, Sparkles, Folder, Eye, 
  ArrowUpDown, Command, Check
} from 'lucide-react';
import { ChatSession } from '../../types/chat';
import { DocumentItem } from '../../types/document';
import { FormatBadge } from '../common/FormatBadge';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  documents?: DocumentItem[];
  onSelectSession: (id: string) => void;
  onSelectDocument?: (doc: DocumentItem) => void;
  onNavigateTab?: (tab: 'chats' | 'projects' | 'vault' | 'chats_list') => void;
  onOpenSettings?: () => void;
  onNewChat?: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  sessions = [],
  documents = [],
  onSelectSession,
  onSelectDocument,
  onNavigateTab,
  onOpenSettings,
  onNewChat,
}) => {
  const [query, setQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'chats' | 'docs' | 'actions'>('all');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Reset query and selection on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setCategoryFilter('all');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Filtered lists
  const filteredSessions = useMemo(() => {
    if (!query) return sessions.slice(0, 5);
    return sessions.filter(s =>
      s.title.toLowerCase().includes(query.toLowerCase())
    );
  }, [sessions, query]);

  const filteredDocs = useMemo(() => {
    if (!query) return documents.slice(0, 5);
    return documents.filter(d =>
      d.filename.toLowerCase().includes(query.toLowerCase())
    );
  }, [documents, query]);

  const systemActions = useMemo(() => [
    {
      id: 'new_chat',
      title: 'Start New Conversation',
      desc: 'Create a clean research thread',
      icon: Plus,
      category: 'actions',
      action: () => { onNewChat?.(); onClose(); }
    },
    {
      id: 'open_projects',
      title: 'Open Research Projects',
      desc: 'Manage isolated workspaces and vector collections',
      icon: Folder,
      category: 'actions',
      action: () => { onNavigateTab?.('projects'); onClose(); }
    },
    {
      id: 'open_vault',
      title: 'Open Knowledge Vault',
      desc: 'Browse, upload, and inspect corpus vector chunks',
      icon: Database,
      category: 'actions',
      action: () => { onNavigateTab?.('vault'); onClose(); }
    },
    {
      id: 'open_settings',
      title: 'Settings & Theme Palettes',
      desc: 'Customize theme tokens, temperature, and vector Top-K',
      icon: Settings,
      category: 'actions',
      action: () => { onOpenSettings?.(); onClose(); }
    },
  ].filter(a => !query || a.title.toLowerCase().includes(query.toLowerCase()) || a.desc.toLowerCase().includes(query.toLowerCase())), [query, onNewChat, onNavigateTab, onOpenSettings, onClose]);

  // Flattened navigable list for keyboard arrows
  const allResults = useMemo(() => {
    const list: Array<{ type: 'session' | 'doc' | 'action'; item: any }> = [];
    if (categoryFilter === 'all' || categoryFilter === 'chats') {
      filteredSessions.forEach(s => list.push({ type: 'session', item: s }));
    }
    if (categoryFilter === 'all' || categoryFilter === 'docs') {
      filteredDocs.forEach(d => list.push({ type: 'doc', item: d }));
    }
    if (categoryFilter === 'all' || categoryFilter === 'actions') {
      systemActions.forEach(a => list.push({ type: 'action', item: a }));
    }
    return list;
  }, [categoryFilter, filteredSessions, filteredDocs, systemActions]);

  // Keyboard navigation listener (Arrow Up/Down, Enter, Esc)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(allResults.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + Math.max(allResults.length, 1)) % Math.max(allResults.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (allResults[selectedIndex]) {
          const selected = allResults[selectedIndex];
          if (selected.type === 'session') {
            onSelectSession(selected.item.session_id);
            onClose();
          } else if (selected.type === 'doc') {
            onSelectDocument?.(selected.item);
            onClose();
          } else if (selected.type === 'action') {
            selected.item.action();
          }
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, allResults, selectedIndex, onSelectSession, onSelectDocument, onClose]);

  if (!isOpen) return null;

  let currentIndexTracker = 0;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 backdrop-blur-md fade-in select-none" 
      style={{ backgroundColor: 'var(--backdrop-color)' }}
      onClick={onClose}
    >
      {/* Modal Container */}
      <div
        className="dropdown-popover w-full max-w-2xl rounded-3xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-[0_24px_64px_rgba(0,0,0,0.35)] overflow-hidden flex flex-col max-h-[80vh] text-[var(--text-main)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3.5 px-5 py-4 border-b border-[var(--border-color)] bg-[var(--bg-modal)]">
          <Search size={19} className="text-[var(--accent-primary)] flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search chats, documents, actions, and settings..."
            className="flex-1 bg-transparent text-[15px] text-[var(--text-main)] placeholder-[var(--text-muted)] placeholder:opacity-80 outline-none font-sans"
            autoFocus
          />

          <div className="flex items-center gap-2">
            {query && (
              <button 
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                onClick={() => { setQuery(''); setSelectedIndex(0); }}
              >
                <X size={14} />
              </button>
            )}
            <kbd className="px-2 py-0.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[11px] font-mono text-[var(--text-muted)] shadow-sm">
              ESC
            </kbd>
          </div>
        </div>

        {/* Filter Category Pills */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] text-xs overflow-x-auto select-none">
          {[
            { id: 'all', label: 'All Results' },
            { id: 'chats', label: `Chats (${filteredSessions.length})` },
            { id: 'docs', label: `Vault Files (${filteredDocs.length})` },
            { id: 'actions', label: `Actions (${systemActions.length})` },
          ].map(tab => (
            <button
              key={tab.id}
              className={`px-3 py-1 rounded-lg transition-all text-xs font-medium cursor-pointer ${
                categoryFilter === tab.id
                  ? 'bg-[var(--bg-card)] text-[var(--text-main)] font-semibold shadow-sm border border-[var(--border-color)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => {
                setCategoryFilter(tab.id as any);
                setSelectedIndex(0);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Results Scroll Area */}
        <div className="flex-1 overflow-y-auto p-2 space-y-4 bg-[var(--bg-modal)]">
          {allResults.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              {/* CHATS SECTION */}
              {(categoryFilter === 'all' || categoryFilter === 'chats') && filteredSessions.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[10.5px] font-bold text-[var(--text-dark)] uppercase tracking-wider select-none">
                    Recent Chats & Research Threads
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    {filteredSessions.map(s => {
                      const itemIdx = currentIndexTracker++;
                      const isSelected = selectedIndex === itemIdx;
                      return (
                        <div
                          key={s.session_id}
                          className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all duration-150 group ${
                            isSelected
                              ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] shadow-sm font-medium'
                              : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                          }`}
                          onClick={() => {
                            onSelectSession(s.session_id);
                            onClose();
                          }}
                          onMouseEnter={() => setSelectedIndex(itemIdx)}
                        >
                          <div className="flex items-center gap-3 truncate pr-2">
                            <div className="w-7 h-7 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] flex items-center justify-center text-[var(--accent-primary)] flex-shrink-0">
                              <MessageSquare size={14} />
                            </div>
                            <div className="truncate">
                              <div className="text-[13px] font-medium truncate">{s.title || 'Untitled chat'}</div>
                              <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5 font-mono">Chat Session</div>
                            </div>
                          </div>
                          <ArrowRight size={13} className="text-[var(--text-dark)] group-hover:text-[var(--text-main)] transition-colors flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* DOCUMENTS SECTION */}
              {(categoryFilter === 'all' || categoryFilter === 'docs') && filteredDocs.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[10.5px] font-bold text-[var(--text-dark)] uppercase tracking-wider select-none">
                    Knowledge Vault Documents
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    {filteredDocs.map(d => {
                      const itemIdx = currentIndexTracker++;
                      const isSelected = selectedIndex === itemIdx;
                      return (
                        <div
                          key={d.filename}
                          className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all duration-150 group ${
                            isSelected
                              ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] shadow-sm font-medium'
                              : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                          }`}
                          onClick={() => {
                            onSelectDocument?.(d);
                            onClose();
                          }}
                          onMouseEnter={() => setSelectedIndex(itemIdx)}
                        >
                          <div className="flex items-center gap-3 truncate pr-2">
                            <FormatBadge filename={d.filename} size="md" />
                            <div className="truncate">
                              <div className="text-[13px] font-medium truncate">{d.filename}</div>
                              <div className="text-[10.5px] text-[var(--text-dark)] font-mono">
                                {d.pages} pages · {d.size_mb} MB
                              </div>
                            </div>
                          </div>
                          <ArrowRight size={13} className="text-[var(--text-dark)] group-hover:text-[var(--text-main)] transition-colors flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* QUICK ACTIONS SECTION */}
              {(categoryFilter === 'all' || categoryFilter === 'actions') && systemActions.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[10.5px] font-bold text-[var(--text-dark)] uppercase tracking-wider select-none">
                    System Actions & Navigation
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    {systemActions.map(a => {
                      const itemIdx = currentIndexTracker++;
                      const isSelected = selectedIndex === itemIdx;
                      const IconComponent = a.icon;
                      return (
                        <div
                          key={a.id}
                          className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all duration-150 group ${
                            isSelected
                              ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] shadow-sm font-medium'
                              : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                          }`}
                          onClick={() => a.action()}
                          onMouseEnter={() => setSelectedIndex(itemIdx)}
                        >
                          <div className="flex items-center gap-3 truncate pr-2">
                            <div className="w-7 h-7 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] flex items-center justify-center text-[var(--accent-primary)] flex-shrink-0">
                              <IconComponent size={14} />
                            </div>
                            <div className="truncate">
                              <div className="text-[13px] font-semibold truncate">{a.title}</div>
                              <div className="text-[11px] text-[var(--text-muted)] truncate">{a.desc}</div>
                            </div>
                          </div>
                          <ArrowRight size={13} className="text-[var(--text-dark)] group-hover:text-[var(--text-main)] transition-colors flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer with Keyboard Navigation Hints */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] text-[11px] text-[var(--text-muted)] font-mono select-none">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[var(--text-main)]">↑</kbd>
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[var(--text-main)]">↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[var(--text-main)]">↵</kbd>
              Select
            </span>
          </div>

          <span className="font-mono text-[10.5px]">
            {allResults.length} {allResults.length === 1 ? 'match' : 'matches'}
          </span>
        </div>
      </div>
    </div>
  );
};

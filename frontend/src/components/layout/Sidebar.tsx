import React, { useState, useEffect } from 'react';
import { 
  Plus, MessageSquare, Folder, Database, Eye, Search, 
  PanelLeft, MoreVertical, Trash2, Edit3, Star, ChevronsUpDown, 
  Settings, Info, X, Check, LogOut, User
} from 'lucide-react';
import { ChatSession, cleanSessionTitle } from '../../types/chat';
import { supabase } from '../../lib/supabase';
import { Skeleton } from '../common/Skeleton';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  activeTab: 'chats' | 'projects' | 'vault' | 'chats_list';
  onSelectTab: (tab: 'chats' | 'projects' | 'vault' | 'chats_list') => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenProjects: () => void;
  documentsCount?: number;
  totalChunksCount?: number;
  streamingSessionIds?: Set<string>;
  isLoadingSessions?: boolean;
  isStatsLoading?: boolean;
  showToast: (msg: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  activeTab,
  onSelectTab,
  onOpenSearch,
  onOpenSettings,
  onOpenProjects,
  documentsCount = 0,
  totalChunksCount = 0,
  streamingSessionIds,
  isLoadingSessions = false,
  isStatsLoading = false,
  showToast,
}) => {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('Account');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data?.user;
      if (user) {
        setUserEmail(user.email ?? null);
        const fullName = user.user_metadata?.full_name || user.user_metadata?.name;
        if (fullName) {
          setUserName(fullName);
        } else if (user.email) {
          const prefix = user.email.split('@')[0];
          setUserName(prefix.charAt(0).toUpperCase() + prefix.slice(1));
        }
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      if (user) {
        setUserEmail(user.email ?? null);
        const fullName = user.user_metadata?.full_name || user.user_metadata?.name;
        if (fullName) {
          setUserName(fullName);
        } else if (user.email) {
          const prefix = user.email.split('@')[0];
          setUserName(prefix.charAt(0).toUpperCase() + prefix.slice(1));
        }
      } else {
        setUserEmail(null);
        setUserName('Account');
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);
  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);

  if (collapsed) return null;

  const handleMobileTabSelect = (action: () => void) => {
    action();
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      onToggleCollapse();
    }
  };

  return (
    <>
      {/* Mobile Drawer Backdrop Overlay */}
      <div 
        className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-xs transition-opacity"
        onClick={onToggleCollapse}
      />

      <aside className="fixed inset-y-0 left-0 z-50 md:relative md:z-20 w-[280px] min-w-[280px] h-full flex flex-col justify-between border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] select-none text-[var(--text-sidebar-item)] shadow-2xl md:shadow-none animate-in slide-in-from-left duration-200">
        {/* Top Header & Brand */}
        <div className="flex flex-col">
          <div className="h-14 px-5 flex items-center justify-between border-b border-[var(--border-color)]">
            <span className="font-serif text-xl font-medium text-[var(--text-main)] tracking-tight">Omni</span>
            <div className="flex items-center gap-1.5">
              <button 
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                onClick={onOpenSearch} 
                title="Search"
              >
                <Search size={16} />
              </button>
              <button 
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                onClick={onToggleCollapse} 
                title="Collapse Sidebar"
              >
                <PanelLeft size={16} />
              </button>
            </div>
          </div>

          {/* Navigation Section */}
          <div className="p-3 flex flex-col gap-1 border-b border-[var(--border-color)]">
            <button 
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all text-left cursor-pointer active:scale-[0.99]"
              onClick={() => handleMobileTabSelect(onNewChat)}
            >
              <Plus size={17} className="text-[var(--accent-primary)] flex-shrink-0" />
              <span>New chat</span>
            </button>

            <button 
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left cursor-pointer ${
                activeTab === 'chats' || activeTab === 'chats_list' 
                  ? 'bg-[var(--bg-card)] text-[var(--text-main)] font-semibold border border-[var(--border-color)]/70 shadow-2xs' 
                  : 'text-[var(--text-sidebar-item)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => handleMobileTabSelect(() => onSelectTab('chats'))}
            >
              <MessageSquare size={17} className={activeTab === 'chats' ? 'text-[var(--accent-primary)]' : 'opacity-80'} />
              <span>Chats</span>
            </button>

            <button 
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left cursor-pointer ${
                activeTab === 'projects' 
                  ? 'bg-[var(--bg-card)] text-[var(--text-main)] font-semibold border border-[var(--border-color)]/70 shadow-2xs' 
                  : 'text-[var(--text-sidebar-item)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => handleMobileTabSelect(() => onSelectTab('projects'))}
            >
              <Folder size={17} className={activeTab === 'projects' ? 'text-[var(--accent-primary)]' : 'opacity-80'} />
              <span>Projects</span>
            </button>

            <button 
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left cursor-pointer ${
                activeTab === 'vault' 
                  ? 'bg-[var(--bg-card)] text-[var(--text-main)] font-semibold border border-[var(--border-color)]/70 shadow-2xs' 
                  : 'text-[var(--text-sidebar-item)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => handleMobileTabSelect(() => onSelectTab('vault'))}
              title={`${documentsCount} document(s) · ${totalChunksCount} indexed chunk(s)`}
            >
              <div className="flex items-center gap-3">
                <Database size={17} className={activeTab === 'vault' ? 'text-[var(--accent-primary)]' : 'opacity-80'} />
                <span>Knowledge Vault</span>
              </div>
              {isStatsLoading ? (
                <Skeleton className="w-5 h-4 rounded-full" />
              ) : documentsCount > 0 ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono font-bold border border-[var(--accent-primary)]/25">
                  {documentsCount}
                </span>
              ) : null}
            </button>
          </div>

          {/* Recents Thread List Header */}
          <div className="px-4 pt-4 pb-2 flex items-center justify-between text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider select-none">
            <span>Recents</span>
          </div>

          {/* Recents Thread List Body */}
          <div className="px-2.5 overflow-y-auto max-h-[calc(100vh-340px)] flex flex-col gap-1">
            {isLoadingSessions ? (
              <div className="flex flex-col gap-1 px-1 py-1">
                {[75, 55, 85, 60, 70].map((w, idx) => (
                  <div key={idx} className="flex items-center px-3.5 py-2.5 rounded-xl">
                    <Skeleton className="h-3.5 rounded-md" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-4 py-6 text-xs text-[var(--text-muted)] text-center font-medium">
                No previous conversations
              </div>
            ) : (
              sessions.map(s => {
                const isActive = currentSessionId === s.session_id && activeTab === 'chats';
                return (
                  <div
                    key={s.session_id}
                    className={`group relative flex items-center justify-between py-2 rounded-xl text-[13.5px] cursor-pointer transition-all ${
                      isActive 
                        ? 'bg-[var(--bg-card)] text-[var(--text-main)] font-semibold border-l-2 border-[var(--accent-primary)] shadow-2xs pl-3 pr-3.5' 
                        : 'text-[var(--text-sidebar-item)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] pl-3.5 pr-3.5'
                    }`}
                    onClick={() => {
                      handleMobileTabSelect(() => {
                        onSelectSession(s.session_id);
                        onSelectTab('chats');
                      });
                    }}
                  >
                    <div className="flex items-center gap-2 truncate flex-1 pr-6">
                      <span className="truncate">{cleanSessionTitle(s.title)}</span>
                      {streamingSessionIds?.has(s.session_id) && (
                        <span className="w-2 h-2 rounded-full bg-[var(--accent-primary)] animate-pulse shadow-[0_0_8px_rgba(224,122,95,0.6)] flex-shrink-0" title="Generating response..." />
                      )}
                    </div>

                    {/* Clean Subtle More Options Button */}
                    <button
                      className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer ${
                        activeMenuSessionId === s.session_id
                          ? 'opacity-100 bg-[var(--bg-hover)] text-[var(--text-main)]'
                          : 'opacity-80 sm:opacity-0 sm:group-hover:opacity-100'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeMenuSessionId === s.session_id) {
                          setActiveMenuSessionId(null);
                          setMenuCoords(null);
                        } else {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setActiveMenuSessionId(s.session_id);
                          const menuWidth = 160;
                          const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8);
                          const top = Math.min(rect.bottom + 4, window.innerHeight - 70);
                          setMenuCoords({ top, left });
                        }
                      }}
                      title="Chat options"
                    >
                      <MoreVertical size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

        {/* Unclipped Fixed Dropdown Popover with Outside Click Dismiss */}
        {activeMenuSessionId && menuCoords && (
          <>
            <div 
              className="fixed inset-0 z-[9998]" 
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuSessionId(null);
                setMenuCoords(null);
              }} 
            />
            <div 
              className="dropdown-popover-top fixed z-[9999] w-40 py-1.5 px-1 bg-[var(--bg-modal)] border border-[var(--border-color)] rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.25)] backdrop-blur-2xl"
              style={{ top: `${menuCoords.top}px`, left: `${menuCoords.left}px` }}
              onClick={e => e.stopPropagation()}
            >
              <button 
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-red-400 hover:bg-red-500/10 rounded-xl text-left transition-colors cursor-pointer"
                onClick={() => {
                  onDeleteSession(activeMenuSessionId);
                  setActiveMenuSessionId(null);
                  setMenuCoords(null);
                }}
              >
                <Trash2 size={14} /> <span>Delete Chat</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* User Profile Footer */}
      <div className="p-3 border-t border-[var(--border-color)] relative">
        <div 
          className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          onClick={() => setProfileMenuOpen(!profileMenuOpen)}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center text-xs font-bold border border-[var(--border-color)] flex-shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 truncate">
              <span className="text-sm font-medium text-[var(--text-main)] truncate">{userName}</span>
              {userEmail && (
                <span className="text-[11px] text-[var(--text-muted)] truncate">{userEmail}</span>
              )}
            </div>
          </div>
          <ChevronsUpDown size={15} className="text-[var(--text-dark)] flex-shrink-0" />
        </div>

        {profileMenuOpen && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setProfileMenuOpen(false)} 
            />
            <div 
              className="dropdown-popover-bottom absolute left-3 right-3 bottom-16 z-50 py-2 px-1.5 bg-[var(--bg-modal)] border border-[var(--border-color)] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.25)] backdrop-blur-2xl"
            >
              <div className="px-3 py-1 text-[10.5px] font-bold text-[var(--text-dark)] uppercase tracking-wider select-none truncate">
                {userEmail || 'Account & Preferences'}
              </div>
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[var(--text-main)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition-all"
                onClick={() => { onOpenSettings(); setProfileMenuOpen(false); }}
              >
                <Settings size={15} className="text-[var(--accent-primary)]" />
                <span>Settings & Themes</span>
              </div>
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[var(--text-main)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition-all"
                onClick={() => { showToast("Omni RAG Engine v2.0 Operational"); setProfileMenuOpen(false); }}
              >
                <Info size={15} className="text-[var(--text-muted)]" />
                <span>System Pipeline Health</span>
              </div>
              <div className="my-1.5 border-t border-[var(--border-color)]" />
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl cursor-pointer transition-all"
                onClick={async () => {
                  setProfileMenuOpen(false);
                  await supabase.auth.signOut();
                  showToast("Signed out successfully");
                }}
              >
                <LogOut size={15} />
                <span>Sign out</span>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
    </>
  );
};

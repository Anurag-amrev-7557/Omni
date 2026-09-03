import React, { useState, useEffect } from 'react';
import { 
  Plus, MessageSquare, Folder, Database, Eye, Search, 
  PanelLeft, MoreVertical, Trash2, Edit3, Star, ChevronsUpDown, 
  Settings, Info, X, Check, LogOut, Network, LogIn, User, Activity
} from 'lucide-react';
import { ChatSession } from '../../types/chat';
import { supabase } from '../../lib/supabase';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  activeTab: 'chats' | 'projects' | 'vault' | 'graph' | 'chats_list';
  onSelectTab: (tab: 'chats' | 'projects' | 'vault' | 'graph' | 'chats_list') => void;
  onOpenSearch: () => void;
  onOpenSettings: (tab?: any) => void;
  onOpenProjects: () => void;
  onOpenAuth?: () => void;
  documentsCount?: number;
  totalChunksCount?: number;
  isLoadingSessions?: boolean;
  isLoadingDocuments?: boolean;
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
  onOpenAuth,
  documentsCount = 0,
  totalChunksCount = 0,
  isLoadingSessions = false,
  isLoadingDocuments = false,
  showToast,
}) => {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null);
    }).catch(() => {
      setUserEmail(null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setUserEmail(null);
      showToast("Signed out successfully");
      setProfileMenuOpen(false);
    } catch (e) {
      console.error("Sign out error:", e);
      showToast("Failed to sign out");
    }
  };

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
        className={`fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-xs transition-opacity duration-300 ${
          collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        onClick={onToggleCollapse}
      />

      <aside 
        className={`fixed inset-y-0 left-0 z-50 md:relative md:z-20 h-full flex flex-col justify-between border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] select-none text-[var(--text-sidebar-item)] shadow-2xl md:shadow-none transition-[width,transform,opacity,border-color] duration-300 ease-in-out overflow-hidden ${
          collapsed 
            ? 'w-0 min-w-0 -translate-x-full md:translate-x-0 opacity-0 pointer-events-none border-transparent' 
            : 'w-[280px] min-w-[280px] translate-x-0 opacity-100'
        }`}
      >
        <div className="w-[280px] min-w-[280px] h-full flex flex-col justify-between">
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
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all text-left cursor-pointer"
              onClick={() => handleMobileTabSelect(onNewChat)}
            >
            <Plus size={17} className="text-[var(--accent-primary)]" />
            <span>New chat</span>
          </button>

          <button 
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left cursor-pointer ${
              activeTab === 'chats' || activeTab === 'chats_list' 
                ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-sm' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            onClick={() => handleMobileTabSelect(() => onSelectTab('chats'))}
          >
            <MessageSquare size={17} className={activeTab === 'chats' || activeTab === 'chats_list' ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} />
            <span>Chats</span>
          </button>

          <button 
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left cursor-pointer ${
              activeTab === 'projects' 
                ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-sm' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            onClick={() => handleMobileTabSelect(() => onSelectTab('projects'))}
          >
            <Folder size={17} className={activeTab === 'projects' ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} />
            <span>Projects</span>
          </button>

          <button 
            className={`flex items-center justify-between px-3.5 h-10 rounded-xl text-sm font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'vault' 
                ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-sm' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            onClick={() => handleMobileTabSelect(() => onSelectTab('vault'))}
            title={`${documentsCount} document(s) · ${totalChunksCount} indexed chunk(s)`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Database size={17} className={`${activeTab === 'vault' ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} flex-shrink-0`} />
              <span className="truncate">Knowledge Vault</span>
            </div>
            <div className="flex items-center justify-end min-w-[28px] h-5 flex-shrink-0">
              {isLoadingDocuments ? (
                <div className="w-5 h-3.5 rounded-full bg-[var(--border-color)]/70 animate-pulse" />
              ) : documentsCount > 0 ? (
                <span className="text-[11.5px] px-2 py-0.5 rounded-full bg-[var(--bg-input)] text-[var(--text-main)] font-mono font-medium border border-[var(--border-color)]">
                  {documentsCount}
                </span>
              ) : null}
            </div>
          </button>

          <button 
            className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left cursor-pointer ${
              activeTab === 'graph' 
                ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-sm' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            onClick={() => handleMobileTabSelect(() => onSelectTab('graph'))}
            title="Interactive Knowledge Graph & Community Clusters"
          >
            <div className="flex items-center gap-3">
              <Network size={17} className={activeTab === 'graph' ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} />
              <span>Knowledge Graph</span>
            </div>
          </button>
        </div>

        {/* Recents Thread List */}
        <div className="px-4 pt-4 pb-1.5 flex items-center justify-between text-xs font-semibold text-[var(--text-dark)] uppercase tracking-wider">
          <span>Recents</span>
        </div>

        <div className="px-2.5 overflow-y-auto max-h-[calc(100vh-340px)] flex flex-col gap-1">
          {isLoadingSessions && sessions.length === 0 ? (
            <div className="flex flex-col gap-1 py-1 px-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl animate-pulse">
                  <div className="w-3.5 h-3.5 rounded-md bg-[var(--border-color)]/40 flex-shrink-0" />
                  <div
                    className="h-3 rounded-md bg-[var(--border-color)]/50"
                    style={{ width: `${50 + (i % 3) * 20}%` }}
                  />
                </div>
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-5 text-sm text-[var(--text-dark)] text-center">
              No previous chats
            </div>
          ) : (
            sessions.map(s => {
              const isActive = currentSessionId === s.session_id && activeTab === 'chats';
              return (
                <div
                  key={s.session_id}
                  className={`group relative flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[13.5px] cursor-pointer transition-colors ${
                    isActive 
                      ? 'bg-[var(--bg-card)] text-[var(--text-main)] font-medium' 
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                  }`}
                  onClick={() => {
                    handleMobileTabSelect(() => {
                      onSelectSession(s.session_id);
                      onSelectTab('chats');
                    });
                  }}
                >
                  <span className="truncate flex-1 pr-6">{s.title || 'Untitled chat'}</span>

                  {/* Clean Subtle More Button - Visible on mobile touch screens and on hover on desktop */}
                  <button
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer ${
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
                    <MoreVertical size={15} />
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
          className="flex items-center justify-between p-2 rounded-xl hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          onClick={() => setProfileMenuOpen(!profileMenuOpen)}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[var(--bg-card)] text-[var(--accent-primary)] flex items-center justify-center text-xs font-bold border border-[var(--border-color)] flex-shrink-0 shadow-2xs">
              {userEmail ? userEmail[0].toUpperCase() : <User size={15} className="text-[var(--text-muted)]" />}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-medium text-[var(--text-main)] truncate leading-snug">
                {userEmail ? userEmail.split('@')[0] : 'Guest Mode'}
              </span>
              <span className="text-[11px] text-[var(--text-muted)] truncate leading-none">
                {userEmail ? userEmail : 'Local Workspace'}
              </span>
            </div>
          </div>
          <ChevronsUpDown size={14} className="text-[var(--text-dark)] flex-shrink-0" />
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
                {userEmail ? `Account: ${userEmail}` : 'Local Workspace'}
              </div>

              {!userEmail && onOpenAuth && (
                <div 
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition-all"
                  onClick={() => { onOpenAuth(); setProfileMenuOpen(false); }}
                >
                  <LogIn size={15} />
                  <span>Sign in / Create account</span>
                </div>
              )}

              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[var(--text-main)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition-all"
                onClick={() => { onOpenSettings('theme'); setProfileMenuOpen(false); }}
              >
                <Settings size={15} className="text-[var(--text-muted)]" />
                <span>Settings & Themes</span>
              </div>

              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[var(--text-main)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer transition-all"
                onClick={() => { onOpenSettings('health'); setProfileMenuOpen(false); }}
              >
                <Activity size={15} className="text-emerald-500" />
                <span className="flex-1">System Pipeline Health</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              {userEmail && (
                <>
                  <div className="my-1.5 border-t border-[var(--border-color)]" />
                  <div 
                    className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-400 hover:bg-red-500/10 rounded-xl cursor-pointer transition-all"
                    onClick={handleSignOut}
                  >
                    <LogOut size={15} />
                    <span>Sign out</span>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  </aside>
    </>
  );
};

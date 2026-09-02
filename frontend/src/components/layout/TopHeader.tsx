import React, { useState } from 'react';
import { PanelLeft, ChevronDown, Share2, Settings, Palette, Check, Download } from 'lucide-react';
import { AuthControls } from './AuthControls';
import { useTheme } from '../../context/ThemeContext';

interface TopHeaderProps {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  activeSessionTitle: string;
  onOpenSettings: () => void;
  onOpenShare: () => void;
  onOpenAuth?: () => void;
  onExportChat?: () => void;
  hasMessages?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  sidebarCollapsed,
  onExpandSidebar,
  activeSessionTitle,
  onOpenSettings,
  onOpenShare,
  onOpenAuth = () => {},
  onExportChat,
  hasMessages = false,
}) => {
  const { theme, setTheme, themesList } = useTheme();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  // Clean title prefix if user referenced vault docs
  const cleanTitle = React.useMemo(() => {
    if (!activeSessionTitle) return 'New chat';
    let t = activeSessionTitle;
    if (t.startsWith('[Focus explicitly on referenced Knowledge Vault documents:')) {
      const idx = t.indexOf(']\n\n');
      if (idx !== -1) {
        t = t.substring(idx + 3).trim();
      } else {
        t = t.replace(/\[Focus explicitly on referenced Knowledge Vault documents:[^\]]+\]/, '').trim();
      }
    }
    return t || 'New chat';
  }, [activeSessionTitle]);

  const activeThemeObj = themesList.find(t => t.id === theme);

  return (
    <header className="h-14 min-h-[52px] w-full px-4 sm:px-6 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-dark)] select-none z-10">
      {/* Left Title & Sidebar Toggle */}
      <div className="flex items-center gap-2.5">
        {sidebarCollapsed && (
          <button 
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-all cursor-pointer shadow-2xs"
            onClick={onExpandSidebar} 
            title="Expand Sidebar"
          >
            <PanelLeft size={15} />
          </button>
        )}

        <div 
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-[var(--bg-hover)] cursor-pointer transition-all group max-w-[220px] sm:max-w-[340px] md:max-w-[480px]"
          onClick={onOpenSettings}
          title="Chat Settings & Inference Config"
        >
          <span className="text-[13.5px] font-medium text-[var(--text-main)] truncate leading-none">
            {cleanTitle}
          </span>
          <ChevronDown size={13} className="text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors flex-shrink-0" />
        </div>
      </div>

      {/* Right Action Icons & Controls */}
      <div className="flex items-center gap-2">
        <AuthControls onOpenAuth={onOpenAuth} />

        {/* Theme Quick Switcher Dropdown */}
        <div className="relative">
          <button 
            className="flex items-center gap-2 h-[32px] px-3 text-[12.5px] font-medium rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-all cursor-pointer shadow-2xs"
            onClick={() => setThemeMenuOpen(!themeMenuOpen)}
            title="Switch Theme"
          >
            {activeThemeObj ? (
              <span 
                className="w-2.5 h-2.5 rounded-full border border-black/20 dark:border-white/20 flex-shrink-0 shadow-xs" 
                style={{ backgroundColor: activeThemeObj.previewColors.bg }}
              />
            ) : (
              <Palette size={13} className="text-[var(--accent-primary)]" />
            )}
            <span className="capitalize hidden sm:inline">{theme}</span>
            <ChevronDown size={12} className="text-[var(--text-muted)]" />
          </button>

          {themeMenuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setThemeMenuOpen(false)} 
              />
              <div 
                className="dropdown-popover-top absolute right-0 top-10 z-50 w-72 max-w-[calc(100vw-24px)] max-h-96 overflow-y-auto py-2 px-1.5 bg-[var(--bg-modal)] border border-[var(--border-color)] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.25)] backdrop-blur-2xl"
              >
                {/* Light Themes */}
                <div className="px-3 py-1.5 text-[10.5px] font-bold text-[var(--text-dark)] uppercase tracking-wider select-none">
                  Light & Warm Palettes
                </div>
                <div className="flex flex-col gap-0.5">
                  {themesList.filter(t => t.category === 'Light').map(t => (
                    <div 
                      key={t.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-[13px] cursor-pointer transition-all duration-150 ${
                        theme === t.id 
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-medium shadow-sm' 
                          : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                      }`}
                      onClick={() => { setTheme(t.id); setThemeMenuOpen(false); }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div 
                          className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-sm flex-shrink-0" 
                          style={{ backgroundColor: t.previewColors.bg }}
                        />
                        <span>{t.name}</span>
                      </div>
                      {theme === t.id && <Check size={14} className="text-[var(--accent-primary)]" />}
                    </div>
                  ))}
                </div>

                <div className="my-2 border-t border-[var(--border-color)]" />

                {/* Dark Themes */}
                <div className="px-3 py-1.5 text-[10.5px] font-bold text-[var(--text-dark)] uppercase tracking-wider select-none">
                  Dark & Night Palettes
                </div>
                <div className="flex flex-col gap-0.5">
                  {themesList.filter(t => t.category === 'Dark').map(t => (
                    <div 
                      key={t.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-[13px] cursor-pointer transition-all duration-150 ${
                        theme === t.id 
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-medium shadow-sm' 
                          : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                      }`}
                      onClick={() => { setTheme(t.id); setThemeMenuOpen(false); }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div 
                          className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-sm flex-shrink-0" 
                          style={{ backgroundColor: t.previewColors.bg }}
                        />
                        <span>{t.name}</span>
                      </div>
                      {theme === t.id && <Check size={14} className="text-[var(--accent-primary)]" />}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Export Chat Button */}
        {onExportChat && hasMessages && (
          <button 
            className="flex items-center gap-1.5 h-[32px] px-3 text-[12.5px] font-medium rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-all cursor-pointer shadow-2xs"
            onClick={onExportChat}
            title="Export chat to Markdown (.md)"
          >
            <Download size={13} className="text-[var(--accent-primary)]" />
            <span className="hidden sm:inline">Export</span>
          </button>
        )}

        {/* Settings Button */}
        <button 
          className="w-[32px] h-[32px] rounded-xl flex items-center justify-center border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-all cursor-pointer shadow-2xs"
          onClick={onOpenSettings}
          title="Settings & Inference Parameters"
        >
          <Settings size={15} />
        </button>
      </div>
    </header>
  );
};

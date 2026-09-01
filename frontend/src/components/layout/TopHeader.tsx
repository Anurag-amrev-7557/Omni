import React, { useState } from 'react';
import { PanelLeft, ChevronDown, Share2, Settings, Palette, Check } from 'lucide-react';
import { AuthControls } from './AuthControls';
import { useTheme } from '../../context/ThemeContext';

interface TopHeaderProps {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  activeSessionTitle: string;
  onOpenSettings: () => void;
  onOpenShare: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  sidebarCollapsed,
  onExpandSidebar,
  activeSessionTitle,
  onOpenSettings,
  onOpenShare,
}) => {
  const { theme, setTheme, themesList } = useTheme();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  return (
    <header className="h-14 min-h-[52px] w-full px-6 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-dark)] select-none">
      {/* Left Title & Collapse */}
      <div className="flex items-center gap-3">
        {sidebarCollapsed && (
          <button 
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            onClick={onExpandSidebar} 
            title="Expand Sidebar"
          >
            <PanelLeft size={16} />
          </button>
        )}

        <div 
          className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-main)] cursor-pointer hover:opacity-80 transition-opacity"
          onClick={onOpenSettings}
        >
          <span className="max-w-[280px] truncate">{activeSessionTitle || 'New chat'}</span>
          <ChevronDown size={14} className="text-[var(--text-muted)]" />
        </div>
      </div>

      {/* Right Action Icons & Theme Quick Switcher */}
      <div className="flex items-center gap-2">
        <AuthControls />

        {/* Theme Quick Switcher Dropdown */}
        <div className="relative">
          <button 
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--text-dark)] transition-all"
            onClick={() => setThemeMenuOpen(!themeMenuOpen)}
            title="Switch Theme"
          >
            <Palette size={13} className="text-[var(--accent-primary)]" />
            <span className="capitalize hidden sm:inline">{theme}</span>
            <ChevronDown size={12} />
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

        <button 
          className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          onClick={onOpenSettings}
          title="Settings & Tokens"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
};

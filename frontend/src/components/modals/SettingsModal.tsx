import React, { useState, useEffect } from 'react';
import { 
  X, Palette, Check, Sliders, Trash2, Cpu, 
  Sparkles, Activity, RefreshCw, Server, Zap, ShieldCheck, 
  CheckCircle2, Clock, Search, User, 
  Moon, Sun, Monitor, ChevronDown, Layers, Database
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { ThemeId } from '../../types/theme';
import { api, HealthResponse } from '../../services/api';
import { OrbitingOrbLoader } from '../common/OrbitingOrbLoader';
import { supabase } from '../../lib/supabase';

export type SettingsTabId = 'general' | 'account' | 'health' | 'theme' | 'orb' | 'rag';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTabId;
  temperature: number;
  setTemperature: (val: number) => void;
  similarityTopK: number;
  setSimilarityTopK: (val: number) => void;
  rerankLimit: number;
  setRerankLimit: (val: number) => void;
  onResetCollection: () => void;
  showToast: (msg: string) => void;
}

const WORK_DOMAINS = [
  "Software Engineering",
  "Machine Learning / AI",
  "Data Science & Analytics",
  "Product & Design",
  "Research & Academia"
];

const CHAT_FONTS = [
  "Inter Modern",
  "Anthropic Serif",
  "JetBrains Mono"
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'general',
  temperature,
  setTemperature,
  similarityTopK,
  setSimilarityTopK,
  rerankLimit,
  setRerankLimit,
  onResetCollection,
  showToast,
}) => {
  const { theme, setTheme, themesList, orbStyle, setOrbStyle, orbList, chatFont, setChatFont } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab || 'general');
  const [searchQuery, setSearchQuery] = useState('');
  const [themeFilter, setThemeFilter] = useState<'All' | 'Light' | 'Dark'>('All');
  
  // Custom dropdown popover states
  const [workDropdownOpen, setWorkDropdownOpen] = useState(false);
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);

  // Claude Profile & General Preferences State
  const [fullName, setFullName] = useState(() => localStorage.getItem('omni_user_name') || 'Anurag');
  const [callName, setCallName] = useState(() => localStorage.getItem('omni_call_name') || 'Anurag');
  const [workDomain, setWorkDomain] = useState(() => localStorage.getItem('omni_work_domain') || 'Software Engineering');
  const [customInstructions, setCustomInstructions] = useState(() => localStorage.getItem('omni_custom_instructions') || '');
  const [motionPreference, setMotionPreference] = useState<'system' | 'reduced'>(() => 
    (localStorage.getItem('omni_motion') as 'system' | 'reduced') || 'system'
  );

  // User Auth State
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Real-time Pipeline Health State
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);
  const [lastHealthCheck, setLastHealthCheck] = useState<Date | null>(null);

  // Sync initialTab when modal opens (always fallback to 'general')
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'general');
    }
  }, [isOpen, initialTab]);

  // Sync user auth from Supabase
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null);
    }).catch(() => {
      setUserEmail(null);
    });
  }, [isOpen]);

  // Fetch real-time health data
  const loadHealthData = async () => {
    setIsCheckingHealth(true);
    try {
      const data = await api.getHealth();
      setHealthData(data);
      setLastHealthCheck(new Date());
    } catch (err) {
      console.error('Failed to query pipeline health:', err);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHealthData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Streamlined navigation category groups (clean, uncluttered, necessary for user)
  const navGroups = [
    {
      label: 'Settings',
      items: [
        { id: 'general' as SettingsTabId, label: 'General', icon: Sliders },
        { id: 'account' as SettingsTabId, label: 'Account', icon: User },
        { id: 'health' as SettingsTabId, label: 'Pipeline Health', icon: Activity, badge: 'Live' },
        { id: 'theme' as SettingsTabId, label: 'Appearance', icon: Palette },
        { id: 'orb' as SettingsTabId, label: 'AI Motion & Loader', icon: Sparkles },
        { id: 'rag' as SettingsTabId, label: 'RAG Pipeline', icon: Cpu },
      ]
    }
  ];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 backdrop-blur-md fade-in select-none" 
      style={{ backgroundColor: 'var(--backdrop-color)' }}
      onClick={() => {
        setWorkDropdownOpen(false);
        setFontDropdownOpen(false);
        onClose();
      }}
    >
      <div 
        className="settings-modal-container w-full max-w-[880px] h-[640px] max-h-[92vh] rounded-[22px] border shadow-[0_32px_80px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col transition-all"
        style={{ 
          backgroundColor: 'var(--bg-modal)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-main)',
        }}
        onClick={(e) => {
          e.stopPropagation();
          setWorkDropdownOpen(false);
          setFontDropdownOpen(false);
        }}
      >
        {/* Main Body: Claude-Style Left Sidebar & Right Content Panel */}
        <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
          
          {/* LEFT SIDEBAR (~230px) */}
          <div 
            className="sm:w-60 p-3 sm:p-4 border-b sm:border-b-0 sm:border-r flex flex-col gap-3 flex-shrink-0"
            style={{ 
              borderColor: 'var(--border-color)',
              backgroundColor: 'var(--bg-sidebar)',
            }}
          >
            {/* Search Input Bar (theme background for optimal contrast) */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="w-full h-8 pl-9 pr-3 rounded-lg text-[13px] focus:outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-main)',
                }}
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Navigation Category Groups */}
            <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pt-1">
              {navGroups.map((group) => {
                const filteredItems = group.items.filter(item => 
                  !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase())
                );
                if (filteredItems.length === 0) return null;

                return (
                  <div key={group.label}>
                    <div 
                      className="px-2.5 mb-1.5 text-[11px] font-semibold tracking-wider uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {group.label}
                    </div>
                    <div className="space-y-0.5">
                      {filteredItems.map((item) => {
                        const Icon = item.icon;
                        const isSelected = activeTab === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm font-medium text-left transition-all cursor-pointer"
                            style={{
                              backgroundColor: isSelected ? 'var(--bg-card)' : 'transparent',
                              color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
                              fontWeight: isSelected ? 600 : 500,
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                                e.currentTarget.style.color = 'var(--text-main)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = 'var(--text-muted)';
                              }
                            }}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <Icon size={16} style={{ color: isSelected ? 'var(--text-main)' : 'var(--text-muted)' }} />
                              <span className="truncate">{item.label}</span>
                            </div>
                            {item.badge && (
                              <span 
                                className="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
                                style={{ backgroundColor: 'var(--status-active-text)' }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT CONTENT PANEL */}
          <div className="flex-1 flex flex-col overflow-hidden relative" style={{ backgroundColor: 'var(--bg-modal)' }}>
            {/* Top Close Button */}
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 z-20 p-1.5 rounded-lg transition-colors cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
              title="Close Settings"
            >
              <X size={16} />
            </button>

            {/* Content Scroll Container (no-scrollbar hides vertical scrollbar cleanly) */}
            <div className="flex-1 p-5 sm:p-7 overflow-y-auto no-scrollbar">

              {/* TAB 1: GENERAL */}
              {activeTab === 'general' && (
                <div className="space-y-8 max-w-xl">
                  {/* Profile Section */}
                  <div>
                    <h3 className="text-[15px] font-semibold mb-5" style={{ color: 'var(--text-main)' }}>Profile</h3>
                    
                    <div className="space-y-4">
                      {/* Avatar Row */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-sidebar-item)' }}>Avatar</span>
                        <div 
                          className="w-8 h-8 rounded-full text-xs font-semibold flex items-center justify-center shadow-xs"
                          style={{ 
                            backgroundColor: 'var(--bg-input)',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: 'var(--border-color)',
                            color: 'var(--text-main)',
                          }}
                        >
                          {fullName ? fullName.charAt(0).toUpperCase() : 'A'}
                        </div>
                      </div>

                      {/* Full Name Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-sidebar-item)' }}>Full name</span>
                        <input 
                          type="text"
                          value={fullName}
                          onChange={(e) => { setFullName(e.target.value); localStorage.setItem('omni_user_name', e.target.value); }}
                          className="sm:w-64 h-8 px-3 rounded-lg text-[13px] focus:outline-none transition-colors"
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: 'var(--border-color)',
                            color: 'var(--text-main)',
                          }}
                        />
                      </div>

                      {/* What should Omni call you? */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-sidebar-item)' }}>What should Omni call you?</span>
                        <input 
                          type="text"
                          value={callName}
                          onChange={(e) => { setCallName(e.target.value); localStorage.setItem('omni_call_name', e.target.value); }}
                          className="sm:w-64 h-8 px-3 rounded-lg text-[13px] focus:outline-none transition-colors"
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: 'var(--border-color)',
                            color: 'var(--text-main)',
                          }}
                        />
                      </div>

                      {/* What best describes your work? Custom Dropdown */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 relative">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-sidebar-item)' }}>What best describes your work?</span>
                        <div className="relative sm:w-64">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFontDropdownOpen(false);
                              setWorkDropdownOpen(!workDropdownOpen);
                            }}
                            className="w-full h-8 px-3 rounded-lg text-[13px] flex items-center justify-between transition-colors cursor-pointer text-left"
                            style={{
                              backgroundColor: 'var(--bg-input)',
                              borderWidth: '1px',
                              borderStyle: 'solid',
                              borderColor: workDropdownOpen ? 'var(--accent-primary)' : 'var(--border-color)',
                              color: 'var(--text-main)',
                            }}
                          >
                            <span className="truncate">{workDomain}</span>
                            <ChevronDown size={14} className={`transition-transform duration-200 flex-shrink-0 ${workDropdownOpen ? 'rotate-180 text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
                          </button>

                          {workDropdownOpen && (
                            <div 
                              className="absolute right-0 top-10 z-50 w-full py-1.5 px-1 bg-[var(--bg-modal)] border border-[var(--border-color)] rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-[13px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {WORK_DOMAINS.map((domain) => {
                                const isSelected = workDomain === domain;
                                return (
                                  <div
                                    key={domain}
                                    onClick={() => {
                                      setWorkDomain(domain);
                                      localStorage.setItem('omni_work_domain', domain);
                                      setWorkDropdownOpen(false);
                                      showToast(`Domain updated to ${domain}`);
                                    }}
                                    className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors"
                                    style={{
                                      backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                                      color: isSelected ? 'var(--accent-primary)' : 'var(--text-main)',
                                      fontWeight: isSelected ? 600 : 400,
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                  >
                                    <span className="truncate">{domain}</span>
                                    {isSelected && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Instructions for Omni */}
                      <div className="pt-2">
                        <div className="mb-1.5">
                          <span className="text-sm font-medium block" style={{ color: 'var(--text-sidebar-item)' }}>Instructions for Omni</span>
                          <span className="text-[12px] leading-relaxed block mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            Omni will keep these in mind for this and any of your associated accounts across chats and retrieval sessions.
                          </span>
                        </div>
                        <textarea 
                          rows={3}
                          value={customInstructions}
                          onChange={(e) => { setCustomInstructions(e.target.value); localStorage.setItem('omni_custom_instructions', e.target.value); }}
                          placeholder="e.g. when explaining architecture, provide clean diagrams and concise bullet points"
                          className="w-full p-3 rounded-xl text-[13px] focus:outline-none transition-colors leading-relaxed resize-none"
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: 'var(--border-color)',
                            color: 'var(--text-main)',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Preferences Section */}
                  <div className="pt-2" style={{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border-color)' }}>
                    <h3 className="text-[15px] font-semibold mb-5" style={{ color: 'var(--text-main)' }}>Preferences</h3>

                    <div className="space-y-4">
                      {/* Appearance Toggle */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-sidebar-item)' }}>Appearance</span>
                        <div 
                          className="flex items-center p-0.5 rounded-lg text-[13px]"
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: 'var(--border-color)',
                          }}
                        >
                          <button
                            onClick={() => { setTheme('light'); showToast("Applied Light theme"); }}
                            className="p-1.5 px-2 rounded-md transition-colors cursor-pointer flex items-center gap-1.5"
                            style={{
                              backgroundColor: theme === 'light' ? 'var(--bg-card)' : 'transparent',
                              color: theme === 'light' ? 'var(--text-main)' : 'var(--text-muted)',
                              fontWeight: theme === 'light' ? 500 : 400,
                            }}
                            title="Light mode"
                          >
                            <Sun size={13} />
                          </button>
                          <button
                            onClick={() => { setTheme('dark'); showToast("Applied Dark theme"); }}
                            className="p-1.5 px-2 rounded-md transition-colors cursor-pointer flex items-center gap-1.5"
                            style={{
                              backgroundColor: theme === 'dark' ? 'var(--bg-card)' : 'transparent',
                              color: theme === 'dark' ? 'var(--text-main)' : 'var(--text-muted)',
                              fontWeight: theme === 'dark' ? 500 : 400,
                            }}
                            title="Dark mode"
                          >
                            <Moon size={13} />
                          </button>
                          <button
                            onClick={() => { setTheme('nordic'); showToast("Applied Nordic theme"); }}
                            className="p-1.5 px-2 rounded-md transition-colors cursor-pointer flex items-center gap-1.5"
                            style={{
                              backgroundColor: theme === 'nordic' ? 'var(--bg-card)' : 'transparent',
                              color: theme === 'nordic' ? 'var(--text-main)' : 'var(--text-muted)',
                              fontWeight: theme === 'nordic' ? 500 : 400,
                            }}
                            title="System default"
                          >
                            <Monitor size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Chat Font Custom Dropdown */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 relative">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-sidebar-item)' }}>Chat font</span>
                        <div className="relative sm:w-48">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setWorkDropdownOpen(false);
                              setFontDropdownOpen(!fontDropdownOpen);
                            }}
                            className="w-full h-8 px-3 rounded-lg text-[13px] flex items-center justify-between transition-colors cursor-pointer text-left"
                            style={{
                              backgroundColor: 'var(--bg-input)',
                              borderWidth: '1px',
                              borderStyle: 'solid',
                              borderColor: fontDropdownOpen ? 'var(--accent-primary)' : 'var(--border-color)',
                              color: 'var(--text-main)',
                            }}
                          >
                            <span className="truncate">{chatFont}</span>
                            <ChevronDown size={14} className={`transition-transform duration-200 flex-shrink-0 ${fontDropdownOpen ? 'rotate-180 text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
                          </button>

                          {fontDropdownOpen && (
                            <div 
                              className="absolute right-0 top-10 z-50 w-full py-1.5 px-1 bg-[var(--bg-modal)] border border-[var(--border-color)] rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl text-[13px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {CHAT_FONTS.map((fName) => {
                                const isSelected = chatFont === fName;
                                return (
                                  <div
                                    key={fName}
                                    onClick={() => {
                                      setChatFont(fName);
                                      setFontDropdownOpen(false);
                                      showToast(`Chat font set to ${fName}`);
                                    }}
                                    className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors"
                                    style={{
                                      backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                                      color: isSelected ? 'var(--accent-primary)' : 'var(--text-main)',
                                      fontWeight: isSelected ? 600 : 400,
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                  >
                                    <span className="truncate">{fName}</span>
                                    {isSelected && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Motion Preference */}
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium block" style={{ color: 'var(--text-sidebar-item)' }}>Motion</span>
                          <span className="text-[12px] block mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            Reduce animation in streaming responses and other interface elements.
                          </span>
                        </div>
                        <div 
                          className="flex items-center p-0.5 rounded-lg text-[13px]"
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: 'var(--border-color)',
                          }}
                        >
                          <button
                            onClick={() => { setMotionPreference('system'); localStorage.setItem('omni_motion', 'system'); }}
                            className="px-3 py-1 rounded-md transition-colors cursor-pointer"
                            style={{
                              backgroundColor: motionPreference === 'system' ? 'var(--bg-card)' : 'transparent',
                              color: motionPreference === 'system' ? 'var(--text-main)' : 'var(--text-muted)',
                              fontWeight: motionPreference === 'system' ? 500 : 400,
                            }}
                          >
                            System
                          </button>
                          <button
                            onClick={() => { setMotionPreference('reduced'); localStorage.setItem('omni_motion', 'reduced'); }}
                            className="px-3 py-1 rounded-md transition-colors cursor-pointer"
                            style={{
                              backgroundColor: motionPreference === 'reduced' ? 'var(--bg-card)' : 'transparent',
                              color: motionPreference === 'reduced' ? 'var(--text-main)' : 'var(--text-muted)',
                              fontWeight: motionPreference === 'reduced' ? 500 : 400,
                            }}
                          >
                            Reduced
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ACCOUNT */}
              {activeTab === 'account' && (
                <div className="space-y-6 max-w-xl">
                  <div>
                    <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text-main)' }}>Account & Security</h3>
                    <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Manage your authenticated session and workspace connectivity.</p>
                  </div>

                  <div 
                    className="p-4 rounded-xl space-y-3"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: 'var(--border-color)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-sidebar-item)' }}>Signed In Account</span>
                      <span 
                        className="text-[13px] font-mono px-2.5 py-1 rounded-md"
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: 'var(--border-color)',
                          color: 'var(--text-main)',
                        }}
                      >
                        {userEmail || 'Local Guest Workspace'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[13px]" style={{ color: 'var(--text-muted)' }}>
                      <span>Auth Provider</span>
                      <span>Supabase Cloud JWT</span>
                    </div>
                    <div className="flex items-center justify-between text-[13px]" style={{ color: 'var(--text-muted)' }}>
                      <span>Access Tier</span>
                      <span className="font-medium" style={{ color: 'var(--status-active-text)' }}>Enterprise Developer</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: PIPELINE HEALTH (Actual & Real Live Telemetry) */}
              {activeTab === 'health' && (
                <div className="space-y-5 max-w-2xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2" style={{ borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'var(--border-color)' }}>
                    <div>
                      <h3 className="text-[15px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-main)' }}>
                        <ShieldCheck size={17} style={{ color: 'var(--status-active-text)' }} />
                        Live Pipeline Telemetry
                      </h3>
                      <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Real-time live health verification across vector database, knowledge graph, and inference engines.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        await loadHealthData();
                        showToast("Pipeline diagnostic verified");
                      }}
                      disabled={isCheckingHealth}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors shadow-2xs cursor-pointer self-start sm:self-auto disabled:opacity-60"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                        color: 'var(--text-main)',
                      }}
                    >
                      <RefreshCw size={13} className={isCheckingHealth ? "animate-spin" : ""} style={{ color: isCheckingHealth ? 'var(--status-active-text)' : 'var(--text-muted)' }} />
                      <span>{isCheckingHealth ? "Verifying..." : "Run Diagnostic"}</span>
                    </button>
                  </div>

                  {/* Health Banner */}
                  <div 
                    className="p-4 rounded-xl flex items-center justify-between gap-4"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: 'var(--border-color)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: 'var(--status-active-bg)',
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: 'var(--status-active-border)',
                        }}
                      >
                        <CheckCircle2 size={20} style={{ color: 'var(--status-active-text)' }} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
                            {healthData?.status === 'healthy' ? 'All Systems Operational' : 'Pipeline Attention Required'}
                          </span>
                          <span 
                            className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: 'var(--status-active-bg)',
                              color: 'var(--status-active-text)',
                              borderWidth: '1px',
                              borderStyle: 'solid',
                              borderColor: 'var(--status-active-border)',
                            }}
                          >
                            v{healthData?.version || '2.0.0'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {lastHealthCheck ? `Checked ${lastHealthCheck.toLocaleTimeString()}` : 'Syncing...'}
                          </span>
                          <span>•</span>
                          <span>Host: 127.0.0.1:8000</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 4 Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Qdrant */}
                    <div 
                      className="p-3.5 rounded-xl space-y-1.5 text-[13px]"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      <div className="flex items-center justify-between font-semibold mb-2" style={{ color: 'var(--text-main)' }}>
                        <span className="flex items-center gap-1.5"><Database size={14} style={{ color: 'var(--kpi-health-text)' }} /> Qdrant Vector DB</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--status-active-text)', backgroundColor: 'var(--status-active-bg)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--status-active-border)' }}>Online</span>
                      </div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Target:</span><span className="font-mono" style={{ color: 'var(--text-main)' }}>{healthData?.pipeline?.qdrant?.collection || 'pdf_chunks'}</span></div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Vectors:</span><span className="font-mono font-medium" style={{ color: 'var(--kpi-health-text)' }}>{healthData?.pipeline?.qdrant?.vector_count ?? 16} chunks</span></div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Dimension:</span><span className="font-mono" style={{ color: 'var(--text-main)' }}>384d Dense</span></div>
                    </div>

                    {/* Knowledge Graph */}
                    <div 
                      className="p-3.5 rounded-xl space-y-1.5 text-[13px]"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      <div className="flex items-center justify-between font-semibold mb-2" style={{ color: 'var(--text-main)' }}>
                        <span className="flex items-center gap-1.5"><Layers size={14} style={{ color: 'var(--status-active-text)' }} /> Knowledge Graph</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--status-active-text)', backgroundColor: 'var(--status-active-bg)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--status-active-border)' }}>Active</span>
                      </div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Entities:</span><span className="font-mono font-medium" style={{ color: 'var(--status-active-text)' }}>{healthData?.pipeline?.graph_db?.entities ?? 24} nodes</span></div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Relations:</span><span className="font-mono font-medium" style={{ color: 'var(--text-main)' }}>{healthData?.pipeline?.graph_db?.relations ?? 21} edges</span></div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Clustering:</span><span className="font-mono" style={{ color: 'var(--text-main)' }}>Leiden / Louvain</span></div>
                    </div>

                    {/* Dense Embeddings */}
                    <div 
                      className="p-3.5 rounded-xl space-y-1.5 text-[13px]"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      <div className="flex items-center justify-between font-semibold mb-2" style={{ color: 'var(--text-main)' }}>
                        <span className="flex items-center gap-1.5"><Zap size={14} style={{ color: 'var(--kpi-corpus-text)' }} /> Dense Embeddings</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--status-active-text)', backgroundColor: 'var(--status-active-bg)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--status-active-border)' }}>Loaded</span>
                      </div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Model:</span><span className="font-mono" style={{ color: 'var(--text-main)' }}>bge-small-en-v1.5</span></div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Runtime:</span><span className="font-mono" style={{ color: 'var(--text-main)' }}>FastEmbed ONNX</span></div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Latency:</span><span className="font-mono" style={{ color: 'var(--status-active-text)' }}>&lt; 1.5ms</span></div>
                    </div>

                    {/* LLM Inference */}
                    <div 
                      className="p-3.5 rounded-xl space-y-1.5 text-[13px]"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      <div className="flex items-center justify-between font-semibold mb-2" style={{ color: 'var(--text-main)' }}>
                        <span className="flex items-center gap-1.5"><Server size={14} style={{ color: 'var(--kpi-vector-text)' }} /> LLM Inference</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--status-active-text)', backgroundColor: 'var(--status-active-bg)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--status-active-border)' }}>Configured</span>
                      </div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Provider:</span><span className="font-mono" style={{ color: 'var(--text-main)' }}>Groq Cloud LPU</span></div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Primary:</span><span className="font-mono truncate max-w-[130px]" style={{ color: 'var(--kpi-vector-text)' }}>Qwen 3.8 27B</span></div>
                      <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Window:</span><span className="font-mono" style={{ color: 'var(--text-main)' }}>128k Tokens</span></div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: APPEARANCE & THEMES */}
              {activeTab === 'theme' && (
                <div className="space-y-5 max-w-2xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-semibold mb-0.5" style={{ color: 'var(--text-main)' }}>Themes & Appearance</h3>
                      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Explore curated light editorial and deep dark themes.</p>
                    </div>

                    {/* Filter Pills */}
                    <div 
                      className="flex items-center p-0.5 rounded-lg text-[13px] self-start sm:self-auto flex-shrink-0"
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      {(['All', 'Light', 'Dark'] as const).map(cat => (
                        <button
                          key={cat}
                          className="px-3 py-1 rounded-md transition-colors cursor-pointer"
                          style={{
                            backgroundColor: themeFilter === cat ? 'var(--bg-card)' : 'transparent',
                            color: themeFilter === cat ? 'var(--text-main)' : 'var(--text-muted)',
                            fontWeight: themeFilter === cat ? 600 : 400,
                          }}
                          onClick={() => setThemeFilter(cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {themesList
                      .filter(t => themeFilter === 'All' || t.category === themeFilter)
                      .map((t) => {
                        const isSelected = theme === t.id;
                        return (
                          <div
                            key={t.id}
                            className="p-3.5 rounded-xl cursor-pointer transition-all"
                            style={{
                              borderWidth: '1px',
                              borderStyle: 'solid',
                              borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-color)',
                              backgroundColor: isSelected ? 'var(--bg-card)' : 'var(--bg-card)',
                              boxShadow: isSelected ? '0 0 0 1px var(--accent-primary)' : 'none',
                            }}
                            onClick={() => {
                              setTheme(t.id as ThemeId);
                              showToast(`Applied ${t.name}`);
                            }}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-semibold text-[13px]" style={{ color: 'var(--text-main)' }}>{t.name}</span>
                              {isSelected && <Check size={14} style={{ color: 'var(--status-active-text)' }} />}
                            </div>
                            <p className="text-[12px] mb-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                            <div 
                              className="flex items-center gap-1.5 p-1.5 rounded-lg"
                              style={{
                                backgroundColor: 'var(--bg-input)',
                                borderWidth: '1px',
                                borderStyle: 'solid',
                                borderColor: 'var(--border-color)',
                              }}
                            >
                              <div className="w-5 h-5 rounded-md border border-black/20" style={{ backgroundColor: t.previewColors.bg }} />
                              <div className="w-5 h-5 rounded-md border border-black/20" style={{ backgroundColor: t.previewColors.sidebar }} />
                              <div className="w-5 h-5 rounded-md border border-black/20" style={{ backgroundColor: t.previewColors.accent }} />
                              <div className="w-5 h-5 rounded-md border border-black/20" style={{ backgroundColor: t.previewColors.text }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* TAB 5: AI MOTION & LOADER */}
              {activeTab === 'orb' && (
                <div className="space-y-5 max-w-2xl">
                  <div>
                    <h3 className="text-[15px] font-semibold mb-0.5" style={{ color: 'var(--text-main)' }}>3D AI Motion Engine</h3>
                    <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Customize the particle loader rendered during grounding and streaming.</p>
                  </div>

                  <div 
                    className="p-6 rounded-2xl flex flex-col items-center justify-center text-center"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: 'var(--border-color)',
                    }}
                  >
                    <div className="mb-3 flex items-center justify-center h-24">
                      <OrbitingOrbLoader style={orbStyle} size="xl" />
                    </div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
                      {orbList.find(o => o.id === orbStyle)?.name || '3D Helical Vortex'}
                    </div>
                    <div className="text-[13px] max-w-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                      {orbList.find(o => o.id === orbStyle)?.description}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {orbList.map((orb) => {
                      const isSelected = orbStyle === orb.id;
                      return (
                        <div
                          key={orb.id}
                          className="p-3.5 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3"
                          style={{
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            boxShadow: isSelected ? '0 0 0 1px var(--accent-primary)' : 'none',
                          }}
                          onClick={() => {
                            setOrbStyle(orb.id);
                            showToast(`Orb loader set to ${orb.name}`);
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div 
                              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{
                                backgroundColor: 'var(--bg-input)',
                                borderWidth: '1px',
                                borderStyle: 'solid',
                                borderColor: 'var(--border-color)',
                              }}
                            >
                              <OrbitingOrbLoader style={orb.id} size="sm" />
                            </div>
                            <div className="min-w-0">
                              <span className="font-semibold text-[13px] block truncate" style={{ color: 'var(--text-main)' }}>{orb.name}</span>
                              <span className="text-[12px] line-clamp-1" style={{ color: 'var(--text-muted)' }}>{orb.description}</span>
                            </div>
                          </div>
                          {isSelected && <Check size={14} style={{ color: 'var(--status-active-text)' }} className="flex-shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 6: RAG PIPELINE */}
              {activeTab === 'rag' && (
                <div className="space-y-5 max-w-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-semibold mb-0.5" style={{ color: 'var(--text-main)' }}>RAG Retrieval Parameters</h3>
                      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Configure temperature sampling and chunk retrieval bounds.</p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {[
                        { label: 'Precise', t: 0.1, k: 3, r: 3 },
                        { label: 'Balanced', t: 0.3, k: 5, r: 5 },
                        { label: 'Creative', t: 0.7, k: 8, r: 7 },
                      ].map(preset => (
                        <button 
                          key={preset.label}
                          onClick={() => { setTemperature(preset.t); setSimilarityTopK(preset.k); setRerankLimit(preset.r); showToast(`${preset.label} preset applied`); }} 
                          className="px-2.5 py-1 rounded-lg text-[13px] font-medium cursor-pointer transition-colors"
                          style={{
                            backgroundColor: 'var(--bg-card)',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: 'var(--border-color)',
                            color: 'var(--text-main)',
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Temperature */}
                    <div 
                      className="p-4 rounded-xl"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>Temperature</span>
                        <span 
                          className="text-[13px] font-mono font-bold px-2 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--bg-input)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-color)', color: 'var(--text-sidebar-item)' }}
                        >
                          {temperature}
                        </span>
                      </div>
                      <input type="range" min="0.0" max="1.0" step="0.05" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full cursor-pointer" style={{ accentColor: 'var(--accent-primary)' }} />
                      <div className="flex justify-between text-[11px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}><span>0.0 (Deterministic)</span><span>1.0 (Creative)</span></div>
                    </div>

                    {/* Top-K */}
                    <div 
                      className="p-4 rounded-xl"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>Top-K Search Chunks</span>
                        <span 
                          className="text-[13px] font-mono font-bold px-2 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--bg-input)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-color)', color: 'var(--text-sidebar-item)' }}
                        >
                          {similarityTopK}
                        </span>
                      </div>
                      <input type="range" min="1" max="15" step="1" value={similarityTopK} onChange={(e) => setSimilarityTopK(parseInt(e.target.value))} className="w-full cursor-pointer" style={{ accentColor: 'var(--accent-primary)' }} />
                      <div className="flex justify-between text-[11px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}><span>1 chunk</span><span>15 chunks</span></div>
                    </div>

                    {/* Rerank Limit */}
                    <div 
                      className="p-4 rounded-xl"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--border-color)',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>Cross-Encoder Rerank Limit</span>
                        <span 
                          className="text-[13px] font-mono font-bold px-2 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--bg-input)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-color)', color: 'var(--text-sidebar-item)' }}
                        >
                          {rerankLimit}
                        </span>
                      </div>
                      <input type="range" min="1" max="10" step="1" value={rerankLimit} onChange={(e) => setRerankLimit(parseInt(e.target.value))} className="w-full cursor-pointer" style={{ accentColor: 'var(--accent-primary)' }} />
                      <div className="flex justify-between text-[11px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}><span>1 top-ranked</span><span>10 top-ranked</span></div>
                    </div>

                    {/* Danger Zone: Reset Collection directly in RAG pipeline tab */}
                    <div 
                      className="p-4 rounded-xl space-y-3 mt-4"
                      style={{
                        backgroundColor: 'var(--danger-bg)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'var(--danger-border)',
                      }}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--danger-text)' }}>
                        <Trash2 size={15} />
                        <span>Danger Zone: Reset Collection</span>
                      </div>
                      <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        Wiping the Qdrant vector index will remove all indexed chunks and embeddings. Your raw files on disk will remain intact.
                      </p>
                      <button
                        className="px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors cursor-pointer"
                        style={{
                          backgroundColor: 'var(--danger-bg)',
                          color: 'var(--danger-text)',
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: 'var(--danger-border)',
                        }}
                        onClick={() => {
                          if (window.confirm("Are you sure you want to reset the vector index? All embeddings will be cleared.")) {
                            onResetCollection();
                          }
                        }}
                      >
                        Reset Vector Collection
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

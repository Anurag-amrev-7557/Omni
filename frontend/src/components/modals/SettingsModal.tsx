import React, { useState } from 'react';
import { X, Palette, Check, Sliders, Database, Trash2, Cpu, Sparkles } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { ThemeId, OrbStyle } from '../../types/theme';
import { api } from '../../services/api';
import { OrbitingOrbLoader } from '../common/OrbitingOrbLoader';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  temperature: number;
  setTemperature: (val: number) => void;
  similarityTopK: number;
  setSimilarityTopK: (val: number) => void;
  rerankLimit: number;
  setRerankLimit: (val: number) => void;
  onResetCollection: () => void;
  showToast: (msg: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  temperature,
  setTemperature,
  similarityTopK,
  setSimilarityTopK,
  rerankLimit,
  setRerankLimit,
  onResetCollection,
  showToast,
}) => {
  const { theme, setTheme, themesList, orbStyle, setOrbStyle, orbList } = useTheme();
  const [activeTab, setActiveTab] = useState<'theme' | 'orb' | 'rag' | 'database'>('theme');
  const [themeFilter, setThemeFilter] = useState<'All' | 'Light' | 'Dark'>('All');

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm fade-in select-none" 
      style={{ backgroundColor: 'var(--backdrop-color)' }}
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-card)] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Sliders size={18} className="text-[var(--accent-primary)]" />
            <h2 className="text-[15px] font-semibold text-[var(--text-main)]">System Settings</h2>
          </div>
          <button 
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body with Responsive Navigation */}
        <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
          {/* Settings Tabs (Horizontal on mobile, vertical sidebar on desktop) */}
          <div className="flex flex-row sm:flex-col overflow-x-auto sm:w-48 p-2 sm:p-3 border-b sm:border-b-0 sm:border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] gap-1 flex-shrink-0">
            <button
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-left transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'theme' 
                  ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-xs' 
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => setActiveTab('theme')}
            >
              <Palette size={14} className="text-[var(--accent-primary)]" />
              <span>Theme & Styling</span>
            </button>

            <button
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-left transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'orb' 
                  ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-xs' 
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => setActiveTab('orb')}
            >
              <Sparkles size={14} className="text-[var(--accent-primary)]" />
              <span>Orb Loader</span>
            </button>

            <button
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-left transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'rag' 
                  ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-xs' 
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => setActiveTab('rag')}
            >
              <Cpu size={14} />
              <span>RAG Pipeline</span>
            </button>

            <button
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-left transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'database' 
                  ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-xs' 
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => setActiveTab('database')}
            >
              <Database size={14} />
              <span>Vector Database</span>
            </button>
          </div>

          {/* Settings Content Area */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-[var(--bg-dark)]">
            {/* THEME SELECTOR TAB */}
            {activeTab === 'theme' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[var(--text-main)] mb-0.5">Color Theme & Design Tokens</h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      Explore warm editorial light palettes and rich dark variants.
                    </p>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center p-0.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-xs self-start sm:self-auto flex-shrink-0">
                    {(['All', 'Light', 'Dark'] as const).map(cat => (
                      <button
                        key={cat}
                        className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                          themeFilter === cat 
                            ? 'bg-[var(--bg-input)] text-[var(--text-main)] font-semibold shadow-xs' 
                            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                        }`}
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
                          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                            isSelected 
                              ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)]/20 shadow-md ring-1 ring-[var(--accent-primary)]' 
                              : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--border-hover)] hover:shadow-2xs'
                          }`}
                          onClick={() => {
                            setTheme(t.id as ThemeId);
                            showToast(`Applied ${t.name}`);
                          }}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-[var(--text-main)]">{t.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-input)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
                                {t.badge}
                              </span>
                            </div>
                            {isSelected && <Check size={14} className="text-[var(--accent-primary)]" />}
                          </div>

                          <p className="text-[11px] text-[var(--text-muted)] mb-3 leading-relaxed">
                            {t.description}
                          </p>

                          {/* Color Swatch Preview */}
                          <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)]">
                            <div className="w-5 h-5 rounded-md border border-black/20" style={{ backgroundColor: t.previewColors.bg }} title="Background" />
                            <div className="w-5 h-5 rounded-md border border-black/20" style={{ backgroundColor: t.previewColors.sidebar }} title="Sidebar" />
                            <div className="w-5 h-5 rounded-md border border-black/20" style={{ backgroundColor: t.previewColors.accent }} title="Accent" />
                            <div className="w-5 h-5 rounded-md border border-black/20" style={{ backgroundColor: t.previewColors.text }} title="Text" />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* DEDICATED ORB & AI ANIMATIONS TAB */}
            {activeTab === 'orb' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--text-main)] mb-0.5">Orb & AI Loader Style</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Customize the 3D particle loader animation rendered during assistant thinking and streaming.
                  </p>
                </div>

                {/* Live Large Showcase Stage */}
                <div className="p-5 sm:p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-xs flex flex-col items-center justify-center text-center">
                  <div className="mb-3 flex items-center justify-center h-20">
                    <OrbitingOrbLoader style={orbStyle} size="xl" />
                  </div>
                  <div className="text-sm font-semibold text-[var(--text-main)]">
                    {orbList.find(o => o.id === orbStyle)?.name || '3D Helical Vortex'}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] max-w-sm mt-0.5">
                    {orbList.find(o => o.id === orbStyle)?.description}
                  </div>
                </div>

                {/* Orb Presets Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {orbList.map((orb) => {
                    const isSelected = orbStyle === orb.id;
                    return (
                      <div
                        key={orb.id}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-subtle)]/20 shadow-md ring-1 ring-[var(--accent-primary)]'
                            : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--border-hover)] hover:shadow-2xs'
                        }`}
                        onClick={() => {
                          setOrbStyle(orb.id);
                          showToast(`Orb loader set to ${orb.name}`);
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Live Interactive Orb Loader Preview */}
                          <div className="w-11 h-11 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] flex items-center justify-center flex-shrink-0 overflow-hidden shadow-xs">
                            <OrbitingOrbLoader style={orb.id} size="sm" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-semibold text-xs text-[var(--text-main)] truncate">{orb.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-input)] text-[var(--text-muted)] font-mono border border-[var(--border-color)] flex-shrink-0">
                                {orb.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-[var(--text-muted)] leading-snug line-clamp-2">
                              {orb.description}
                            </p>
                          </div>
                        </div>

                        {isSelected && <Check size={14} className="text-[var(--accent-primary)] flex-shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* RAG PIPELINE PARAMETERS TAB */}
            {activeTab === 'rag' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--text-main)] mb-0.5">Retrieval & Generation Settings</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Tune temperature sampling, similarity top-K document chunk retrieval, and cross-encoder rerank limit.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Temperature Slider */}
                  <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[var(--text-main)]">Temperature</span>
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--accent-primary)]">
                        {temperature}
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="0.0" 
                      max="1.0" 
                      step="0.05"
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value))}
                      className="w-full accent-[var(--accent-primary)] cursor-pointer"
                    />
                    <div className="flex items-center justify-between text-[10.5px] text-[var(--text-muted)] mt-1 font-mono">
                      <span>0.0 (Deterministic)</span>
                      <span>1.0 (Creative)</span>
                    </div>
                  </div>

                  {/* Similarity Top-K */}
                  <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[var(--text-main)]">Similarity Top-K Chunks</span>
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--accent-primary)]">
                        {similarityTopK}
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="15" 
                      step="1"
                      value={similarityTopK}
                      onChange={(e) => setSimilarityTopK(parseInt(e.target.value))}
                      className="w-full accent-[var(--accent-primary)] cursor-pointer"
                    />
                    <div className="flex items-center justify-between text-[10.5px] text-[var(--text-muted)] mt-1 font-mono">
                      <span>1 chunk</span>
                      <span>15 chunks</span>
                    </div>
                  </div>

                  {/* Rerank Limit */}
                  <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[var(--text-main)]">Cross-Encoder Rerank Limit</span>
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--accent-primary)]">
                        {rerankLimit}
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="10" 
                      step="1"
                      value={rerankLimit}
                      onChange={(e) => setRerankLimit(parseInt(e.target.value))}
                      className="w-full accent-[var(--accent-primary)] cursor-pointer"
                    />
                    <div className="flex items-center justify-between text-[10.5px] text-[var(--text-muted)] mt-1 font-mono">
                      <span>1 top-ranked</span>
                      <span>10 top-ranked</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* VECTOR DATABASE TAB */}
            {activeTab === 'database' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--text-main)] mb-0.5">Vector Database Maintenance</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Manage Qdrant collection indexes, clear vector embeddings, and re-initialize memory storage.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-500">
                    <Trash2 size={15} />
                    <span>Danger Zone: Reset Collection</span>
                  </div>
                  <p className="text-[11.5px] text-[var(--text-muted)] leading-relaxed">
                    Wiping the Qdrant vector index will remove all indexed chunks and embeddings. Your raw files on disk will remain intact.
                  </p>
                  <button
                    className="px-3.5 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium transition-colors cursor-pointer"
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

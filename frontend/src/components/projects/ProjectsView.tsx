import React, { useState } from 'react';
import { 
  Folder, Plus, Database, MessageSquare, ArrowRight, 
  Search, Check, Trash2, Edit3, X, FileText, Clock, Layers, Sparkles
} from 'lucide-react';
import { ProjectItem } from '../../types/project';
import { DocumentItem } from '../../types/document';

interface ProjectsViewProps {
  projects: ProjectItem[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string, description: string, color: string) => void;
  onDeleteProject: (id: string) => void;
  onOpenVault: () => void;
  onStartChatInProject: (projectId: string) => void;
  documents: DocumentItem[];
  showToast: (msg: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onOpenVault,
  onStartChatInProject,
  documents,
  showToast,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active'>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#da7756');

  const colorOptions = ['#da7756', '#588157', '#0f766e', '#d97706', '#6366f1', '#ec4899'];

  const filteredProjects = projects
    .filter(p => {
      const matches = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matches) return false;
      if (activeFilter === 'active') return p.id === activeProjectId;
      return true;
    });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) {
      showToast('Project name is required');
      return;
    }
    onCreateProject(newProjectName.trim(), newProjectDesc.trim(), newProjectColor);
    setNewProjectName('');
    setNewProjectDesc('');
    setIsCreateModalOpen(false);
    showToast(`Created project "${newProjectName.trim()}"`);
  };

  const totalDocs = projects.reduce((acc, p) => acc + p.documentCount, 0);
  const totalChats = projects.reduce((acc, p) => acc + p.chatCount, 0);
  const currentProject = projects.find(p => p.id === activeProjectId);

  return (
    <div className="relative flex flex-col h-full w-full bg-[var(--bg-dark)] select-none fade-in overflow-hidden">
      
      {/* Main Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 md:px-10 md:py-8">
        <div className="w-full space-y-4">
          
          {/* Prominent Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[var(--border-color)]">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <Folder size={22} className="text-[var(--accent-primary)] flex-shrink-0" />
                <h1 className="font-serif text-[24px] font-normal text-[var(--text-main)] tracking-tight">
                  Research Projects & Workspaces
                </h1>
                <div 
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border"
                  style={{
                    backgroundColor: 'var(--status-active-bg)',
                    color: 'var(--status-active-text)',
                    borderColor: 'var(--status-active-border)',
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-active-text)] animate-pulse" />
                  <span>Vector Partitions Active</span>
                </div>
              </div>
              <p className="text-[13px] text-[var(--text-muted)] max-w-2xl leading-relaxed">
                Organize document sets into custom workspace collections with isolated vector embeddings and project-specific chat threads.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <button
                className="h-9 px-4 rounded-lg bg-[var(--accent-primary)] text-white hover:opacity-95 text-[13px] font-medium transition-all inline-flex items-center gap-2 cursor-pointer shadow-xs active:scale-[0.98]"
                onClick={() => setIsCreateModalOpen(true)}
              >
                <Plus size={15} className="stroke-[2.5]" />
                <span>New Project</span>
              </button>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 select-none">
            <div className="relative w-full sm:w-80">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input
                type="text"
                placeholder="Filter projects by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl text-[13px] text-[var(--text-main)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-all shadow-2xs"
              />
              {searchQuery && (
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)] p-0.5 rounded cursor-pointer"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="flex items-center p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[12.5px] shadow-2xs self-start sm:self-auto">
              <button
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  activeFilter === 'all' 
                    ? 'bg-[var(--bg-input)] text-[var(--text-main)] font-semibold shadow-xs' 
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] font-medium'
                }`}
                onClick={() => setActiveFilter('all')}
              >
                All ({projects.length})
              </button>
              <button
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  activeFilter === 'active' 
                    ? 'bg-[var(--bg-input)] text-[var(--text-main)] font-semibold shadow-xs' 
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] font-medium'
                }`}
                onClick={() => setActiveFilter('active')}
              >
                Active Workspace
              </button>
            </div>
          </div>

          {/* Project Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
            {filteredProjects.map((project) => {
              const isActive = project.id === activeProjectId;
              return (
                <div
                  key={project.id}
                  className={`p-5 rounded-2xl border transition-all flex flex-col justify-between select-none ${
                    isActive
                      ? 'bg-[var(--accent-subtle)] border-[var(--accent-primary)] shadow-sm'
                      : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-[var(--text-muted)] hover:shadow-2xs'
                  }`}
                >
                  <div>
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-3 mb-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div 
                          className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-xs" 
                          style={{ backgroundColor: project.color || 'var(--accent-primary)' }}
                        />
                        <h3 className="font-semibold text-[14px] text-[var(--text-main)] truncate">
                          {project.name}
                        </h3>
                      </div>

                      {isActive ? (
                        <span 
                          className="text-[10.5px] px-2 py-0.5 rounded-full font-semibold border flex-shrink-0"
                          style={{
                            backgroundColor: 'var(--status-active-bg)',
                            color: 'var(--status-active-text)',
                            borderColor: 'var(--status-active-border)',
                          }}
                        >
                          Active
                        </span>
                      ) : (
                        <button
                          className="text-[11.5px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer"
                          onClick={() => {
                            onSelectProject(project.id);
                            showToast(`Switched workspace to "${project.name}"`);
                          }}
                        >
                          Switch
                        </button>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed line-clamp-3 mb-4">
                      {project.description}
                    </p>
                  </div>

                  <div>
                    {/* Meta Details */}
                    <div className="flex items-center justify-between py-2.5 border-t border-[var(--border-color)] text-[11.5px] text-[var(--text-muted)] mb-3">
                      <div className="flex items-center gap-1.5 font-mono">
                        <FileText size={12.5} />
                        <span>{project.documentCount} docs</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono">
                        <MessageSquare size={12.5} />
                        <span>{project.chatCount} chats</span>
                      </div>
                      <div className="flex items-center gap-1 font-mono">
                        <Clock size={11.5} />
                        <span>{project.createdAt}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        className="flex-1 h-8.5 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-[12.5px] font-medium text-[var(--text-main)] transition-colors cursor-pointer active:scale-[0.98]"
                        onClick={() => onStartChatInProject(project.id)}
                      >
                        <MessageSquare size={13} className="text-[var(--accent-primary)]" />
                        <span>Chat</span>
                      </button>

                      <button
                        className="flex-1 h-8.5 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-[12.5px] font-medium text-[var(--text-main)] transition-colors cursor-pointer active:scale-[0.98]"
                        onClick={onOpenVault}
                      >
                        <Database size={13} />
                        <span>Vault</span>
                      </button>

                      {!project.isDefault && (
                        <button
                          className="h-8.5 w-8.5 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors cursor-pointer"
                          onClick={() => {
                            onDeleteProject(project.id);
                            showToast(`Deleted "${project.name}"`);
                          }}
                          title="Delete project"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Docked Bottom Status & Metrics Ribbon */}
      <footer className="h-12 min-h-[48px] border-t border-[var(--border-color)] bg-[var(--bg-card)] flex items-center justify-between select-none flex-shrink-0 shadow-2xs">
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 overflow-hidden">
          
          {/* Left: Workspaces Count & Active */}
          <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] shadow-2xs flex-shrink-0">
            <Folder size={13} className="text-[var(--accent-primary)]" />
            <span className="text-[12px] sm:text-[12.5px] font-semibold text-[var(--text-main)]">
              {projects.length} <span className="hidden xs:inline">Workspaces</span>
            </span>
            <span className="text-[11px] sm:text-[11.5px] text-[var(--text-muted)] font-medium truncate max-w-[120px] sm:max-w-none">
              ({currentProject?.name || 'Primary'})
            </span>
          </div>

          {/* Middle: Linked Docs & Research Chats */}
          <div className="hidden md:flex items-center gap-3 px-3 py-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] shadow-2xs">
            <div className="flex items-center gap-1.5">
              <FileText size={14} className="text-blue-500" />
              <span className="text-[12.5px] font-semibold text-[var(--text-main)]">{documents.length || totalDocs}</span>
              <span className="text-[12px] text-[var(--text-muted)]">Linked Docs</span>
            </div>

            <span className="w-1 h-1 rounded-full bg-[var(--text-muted)] opacity-50" />

            <div className="flex items-center gap-1.5">
              <MessageSquare size={14} className="text-emerald-500" />
              <span className="text-[12.5px] font-semibold text-[var(--text-main)]">{totalChats}</span>
              <span className="text-[12px] text-[var(--text-muted)]">Research Threads</span>
            </div>
          </div>

          {/* Right: Partition Status */}
          <div className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3 py-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] shadow-2xs flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-[11.5px] sm:text-[12px] font-semibold text-[var(--text-main)]">Namespaces Active</span>
            </div>
          </div>

        </div>
      </footer>

      {/* Create Project Workspace Modal */}
      {isCreateModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm fade-in select-none"
          style={{ backgroundColor: 'var(--backdrop-color)' }}
          onClick={() => setIsCreateModalOpen(false)}
        >
          <div 
            className="w-full max-w-md rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-2xl p-6 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border-color)] mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center shadow-2xs">
                  <Folder size={17} />
                </div>
                <div>
                  <h2 className="text-[16px] font-semibold text-[var(--text-main)] tracking-tight">Create Workspace</h2>
                  <p className="text-[12px] text-[var(--text-muted)]">Configure isolated vector collection and documents</p>
                </div>
              </div>
              <button 
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                onClick={() => setIsCreateModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-[12.5px] font-medium text-[var(--text-main)] mb-1">
                  Project Workspace Name
                </label>
                <input
                  type="text"
                  placeholder="e.g., Q3 Financial Intelligence"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[13px] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-all shadow-2xs"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[12.5px] font-medium text-[var(--text-main)] mb-1">
                  Scope & Research Goals
                </label>
                <textarea
                  placeholder="Describe document categories, research benchmarks, or team scope..."
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3.5 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[13px] text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] resize-none transition-all shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-[12.5px] font-medium text-[var(--text-main)] mb-2">
                  Accent Color Tag
                </label>
                <div className="flex items-center gap-2.5">
                  {colorOptions.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`w-7 h-7 rounded-full transition-transform cursor-pointer shadow-2xs ${
                        newProjectColor === c ? 'scale-115 ring-2 ring-offset-2 ring-[var(--accent-primary)]' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      onClick={() => setNewProjectColor(c)}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 rounded-lg bg-[var(--accent-primary)] text-white hover:opacity-90 active:scale-[0.98] text-[13px] font-medium shadow-xs cursor-pointer transition-all"
                >
                  Create Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

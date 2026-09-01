import React from 'react';
import { X, Folder, Plus, Database } from 'lucide-react';

interface ProjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string) => void;
}

export const ProjectsModal: React.FC<ProjectsModalProps> = ({
  isOpen,
  onClose,
  showToast,
}) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm fade-in" 
      style={{ backgroundColor: 'var(--backdrop-color)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Folder size={18} className="text-[var(--accent-primary)]" />
            <h2 className="text-sm font-semibold text-[var(--text-main)]">Research Projects</h2>
          </div>
          <button className="text-[var(--text-muted)] hover:text-[var(--text-main)]" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)] mb-5">
          Organize document sets into custom workspace projects with dedicated vector collections.
        </p>

        {/* Project List */}
        <div className="space-y-2 mb-5">
          <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-xs">
            <div className="flex items-center gap-2.5">
              <Database size={15} className="text-[var(--accent-primary)]" />
              <div>
                <div className="font-semibold text-[var(--text-main)]">Primary Knowledge Base</div>
                <div className="text-[10px] text-[var(--text-muted)]">Default Workspace Collection (Active)</div>
              </div>
            </div>
            <span 
              className="text-[10px] px-2.5 py-0.5 rounded-full font-medium border"
              style={{
                backgroundColor: 'var(--status-active-bg)',
                color: 'var(--status-active-text)',
                borderColor: 'var(--status-active-border)',
              }}
            >
              Active
            </span>
          </div>
        </div>

        <button
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-[var(--border-color)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--accent-primary)] transition-all"
          onClick={() => showToast("Multi-workspace projects enabled")}
        >
          <Plus size={14} />
          <span>Create New Project Workspace</span>
        </button>
      </div>
    </div>
  );
};

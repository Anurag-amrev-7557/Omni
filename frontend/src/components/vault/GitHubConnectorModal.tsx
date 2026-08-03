import React, { useState } from 'react';
import { X, Search, FolderGit2, FileCode2, Loader2, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import { api } from '../../services/api';

const GitHubIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

interface GitHubFile {
  path: string;
  filename: string;
  size: number;
  size_kb: number;
  ext: string;
  sha: string;
  url: string;
}

interface PreviewResult {
  owner: string;
  repo: string;
  branch: string;
  total_blobs: number;
  matched_count: number;
  truncated: boolean;
  files: GitHubFile[];
}

interface SyncResult {
  success: boolean;
  owner: string;
  repo: string;
  branch: string;
  ingested_count: number;
  failed_count: number;
  ingested_files: { path: string; filename: string; size_bytes: number }[];
  failed_files: { path: string; error: string }[];
}

interface GitHubConnectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete: () => void;
  onAddDocument?: (doc: any) => void;
  showToast: (msg: string) => void;
}

type Step = 'input' | 'preview' | 'syncing' | 'done';

export const GitHubConnectorModal: React.FC<GitHubConnectorModalProps> = ({
  isOpen,
  onClose,
  onSyncComplete,
  onAddDocument,
  showToast,
}) => {
  const [step, setStep] = useState<Step>('input');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [subfolder, setSubfolder] = useState('');
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Real-time streaming sync state
  const [syncCurrent, setSyncCurrent] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [currentSyncPath, setCurrentSyncPath] = useState('');
  const [streamedFiles, setStreamedFiles] = useState<Array<{ path: string; filename?: string; size_mb?: number; status: 'success' | 'error'; error?: string }>>([]);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setStep('input');
    setRepoUrl('');
    setBranch('');
    setSubfolder('');
    setToken('');
    setIsLoading(false);
    setError('');
    setPreview(null);
    setSelectedPaths(new Set());
    setSyncCurrent(0);
    setSyncTotal(0);
    setCurrentSyncPath('');
    setStreamedFiles([]);
    setSyncResult(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handlePreview = async () => {
    if (!repoUrl.trim()) {
      setError('Please enter a repository URL or owner/repo');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const result = await api.githubPreview({
        repo: repoUrl.trim(),
        repo_url: repoUrl.trim(),
        branch: branch.trim() || undefined,
        subfolder: subfolder.trim() || undefined,
        token: token.trim() || undefined,
      });
      setPreview(result);
      setSelectedPaths(new Set(result.files.map((f: GitHubFile) => f.path)));
      setStep('preview');
    } catch (e: any) {
      setError(e.message || 'Failed to connect to repository');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async () => {
    if (!preview || selectedPaths.size === 0) return;
    setStep('syncing');
    setError('');
    setSyncCurrent(0);
    setSyncTotal(selectedPaths.size);
    setCurrentSyncPath('');
    setStreamedFiles([]);

    try {
      const paths = Array.from(selectedPaths);
      const result = await api.githubSyncStream({
        repo: repoUrl.trim(),
        repo_url: repoUrl.trim(),
        branch: preview.branch,
        files: paths,
        selected_paths: paths,
        token: token.trim() || undefined,
      }, (event) => {
        if (event.type === 'start') {
          if (event.total) setSyncTotal(event.total);
        } else if (event.type === 'progress') {
          setSyncCurrent(event.current);
          if (event.total) setSyncTotal(event.total);
          setCurrentSyncPath(event.path);
          setStreamedFiles(prev => [
            {
              path: event.path,
              filename: event.filename,
              size_mb: event.size_mb,
              status: event.status,
              error: event.error,
            },
            ...prev,
          ]);

          // Immediately inject entry into the knowledge vault table
          if (event.status === 'success' && event.filename) {
            onAddDocument?.({
              filename: event.filename,
              size_mb: event.size_mb || 0,
              pages: 1,
              indexed: true,
            });
          }
        } else if (event.type === 'done') {
          setSyncResult(event);
        }
      });

      if (result) {
        setSyncResult(result);
      }
      setStep('done');
      onSyncComplete();
      showToast(`Synced ${result?.ingested_count || paths.length} file(s) from ${preview.owner}/${preview.repo}`);
    } catch (e: any) {
      setError(e.message || 'Sync failed');
      setStep('preview');
    }
  };

  const togglePath = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    if (selectedPaths.size === preview.files.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(preview.files.map(f => f.path)));
    }
  };

  // Group files by top-level directory
  const groupedFiles = preview?.files.reduce<Record<string, GitHubFile[]>>((acc, file) => {
    const parts = file.path.split('/');
    const group = parts.length > 1 ? parts[0] : '(root)';
    if (!acc[group]) acc[group] = [];
    acc[group].push(file);
    return acc;
  }, {}) || {};

  const extColors: Record<string, string> = {
    py: '#3572A5', ts: '#3178C6', tsx: '#3178C6', js: '#F7DF1E', jsx: '#F7DF1E',
    md: '#083FA1', json: '#292929', yaml: '#CB171E', yml: '#CB171E', go: '#00ADD8',
    rs: '#DEA584', java: '#B07219', sql: '#E38C00', css: '#563D7C', html: '#E34C26',
    sh: '#89E051', toml: '#9C4221', txt: '#6B7280',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm fade-in select-none"
      style={{ backgroundColor: 'var(--backdrop-color)' }}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-[var(--bg-modal)] border border-[var(--border-color)] shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center">
              <GitHubIcon size={16} className="text-[var(--accent-primary)]" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-main)] tracking-tight">
                {step === 'input' && 'Connect GitHub Repository'}
                {step === 'preview' && 'Select Files to Ingest'}
                {step === 'syncing' && 'Syncing Repository…'}
                {step === 'done' && 'Sync Complete'}
              </h2>
              <p className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
                {step === 'input' && 'Import code and docs directly from any public or private repo'}
                {step === 'preview' && `${preview?.owner}/${preview?.repo} · ${preview?.branch}`}
                {step === 'syncing' && 'Downloading and indexing files into the Knowledge Vault'}
                {step === 'done' && `${syncResult?.ingested_count} files ingested`}
              </p>
            </div>
          </div>
          <button
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={handleClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-red-500/8 border border-red-500/20 text-[12.5px] text-red-400">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Step: Input */}
          {step === 'input' && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-main)] mb-1.5">
                  Repository <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="owner/repo or https://github.com/owner/repo"
                  className="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]/30 transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handlePreview()}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-[var(--text-main)] mb-1.5">
                    Branch
                  </label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main (default)"
                    className="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]/30 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[var(--text-main)] mb-1.5">
                    Subfolder
                  </label>
                  <input
                    type="text"
                    value={subfolder}
                    onChange={(e) => setSubfolder(e.target.value)}
                    placeholder="src/ (optional)"
                    className="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]/30 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-main)] mb-1.5">
                  Personal Access Token
                  <span className="font-normal text-[var(--text-muted)] ml-1">(optional, for private repos)</span>
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxx"
                  className="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]/30 transition-all font-mono"
                />
              </div>

              <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-muted)] px-0.5 pt-1">
                <FolderGit2 size={13} className="text-[var(--accent-primary)] flex-shrink-0" />
                <span>Supported: Python, TypeScript, JavaScript, Markdown, JSON, YAML, Go, Rust, and more.</span>
              </div>
            </div>
          )}

          {/* Step: Preview */}
          {step === 'preview' && preview && (
            <div className="space-y-3">
              {/* Stats row */}
              <div className="flex items-center gap-3 text-[12px] text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text-main)]">{preview.matched_count} files</span>
                <span>·</span>
                <span>{preview.total_blobs} total blobs</span>
                <span>·</span>
                <span className="font-medium text-[var(--accent-primary)]">{selectedPaths.size} selected</span>
                {preview.truncated && (
                  <>
                    <span>·</span>
                    <span className="text-yellow-400">Tree was truncated</span>
                  </>
                )}
              </div>

              {/* Select all toggle */}
              <button
                className="text-[12px] font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
                onClick={toggleAll}
              >
                {selectedPaths.size === preview.files.length ? 'Deselect All' : 'Select All'}
              </button>

              {/* Grouped file tree */}
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {Object.entries(groupedFiles)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([group, files]) => (
                    <div key={group}>
                      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-muted)] mb-1 sticky top-0 bg-[var(--bg-modal)] py-1 z-10">
                        <FolderGit2 size={12} className="text-[var(--accent-primary)]" />
                        <span>{group}/</span>
                        <span className="font-normal text-[var(--text-muted)]">({files.length})</span>
                      </div>
                      <div className="space-y-0.5 pl-4">
                        {files.map((file) => {
                          const isSelected = selectedPaths.has(file.path);
                          return (
                            <label
                              key={file.sha}
                              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-[12.5px] ${
                                isSelected
                                  ? 'bg-[var(--accent-subtle)] text-[var(--text-main)]'
                                  : 'hover:bg-[var(--bg-hover)] text-[var(--text-muted)]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => togglePath(file.path)}
                                className="accent-[var(--accent-primary)] w-3.5 h-3.5 rounded cursor-pointer"
                              />
                              <FileCode2 size={13} style={{ color: extColors[file.ext] || 'var(--text-muted)' }} className="flex-shrink-0" />
                              <span className="truncate flex-1 font-mono">{file.path.replace(group === '(root)' ? '' : group + '/', '')}</span>
                              <span className="text-[11px] text-[var(--text-muted)] font-mono flex-shrink-0">{file.size_kb} KB</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Step: Syncing with Live Progress */}
          {step === 'syncing' && (
            <div className="py-4 space-y-4">
              {/* Progress Card */}
              <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2.5">
                <div className="flex items-center justify-between text-[12.5px] font-medium text-[var(--text-main)]">
                  <span className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                    <span>Syncing repository into Qdrant vector vault</span>
                  </span>
                  <span className="font-mono text-[var(--accent-primary)] font-semibold">
                    {syncTotal > 0 ? `${Math.round((syncCurrent / syncTotal) * 100)}%` : '0%'}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 rounded-full bg-[var(--bg-input)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent-primary)] transition-all duration-300 rounded-full"
                    style={{ width: `${syncTotal > 0 ? Math.round((syncCurrent / syncTotal) * 100) : 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11.5px] text-[var(--text-muted)]">
                  <span className="truncate max-w-xs font-mono">
                    {currentSyncPath ? `Current: ${currentSyncPath}` : 'Fetching files...'}
                  </span>
                  <span className="font-mono flex-shrink-0">
                    {syncCurrent} / {syncTotal || selectedPaths.size} files
                  </span>
                </div>
              </div>

              {/* Live Streaming Feed */}
              {streamedFiles.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[12px] font-semibold text-[var(--text-main)] px-0.5 flex items-center justify-between">
                    <span>Live Ingestion Feed</span>
                    <span className="text-[11px] text-emerald-400 font-normal">
                      Auto-adding to vault table in background
                    </span>
                  </div>
                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                    {streamedFiles.map((f, i) => (
                      <div
                        key={`${f.path}_${i}`}
                        className={`flex items-center justify-between p-2 rounded-lg text-xs border ${
                          f.status === 'success'
                            ? 'bg-emerald-500/5 border-emerald-500/15 text-[var(--text-main)]'
                            : 'bg-red-500/5 border-red-500/15 text-red-400'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          {f.status === 'success' ? (
                            <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                          ) : (
                            <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
                          )}
                          <span className="font-mono truncate">{f.path}</span>
                        </div>
                        <span className="font-mono text-[11px] text-[var(--text-muted)] flex-shrink-0">
                          {f.status === 'success' ? (f.size_mb !== undefined ? `${f.size_mb} MB` : 'Done') : 'Failed'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && syncResult && (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center py-6">
                <CheckCircle2 size={36} className="text-emerald-400 mb-3" />
                <p className="text-[15px] font-semibold text-[var(--text-main)] mb-1">
                  Repository Synced Successfully
                </p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {syncResult.ingested_count} file(s) ingested from {syncResult.owner}/{syncResult.repo}
                  {syncResult.failed_count > 0 && (
                    <span className="text-yellow-400"> · {syncResult.failed_count} failed</span>
                  )}
                </p>
              </div>

              {/* Ingested files summary */}
              {syncResult.ingested_files.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {syncResult.ingested_files.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-500/5 text-[12px]">
                      <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
                      <span className="font-mono truncate text-[var(--text-main)]">{f.path}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Failed files */}
              {syncResult.failed_files.length > 0 && (
                <div className="max-h-24 overflow-y-auto space-y-0.5">
                  {syncResult.failed_files.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-500/5 text-[12px]">
                      <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
                      <span className="font-mono truncate text-[var(--text-muted)]">{f.path}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-color)]">
          <div className="text-[12px] text-[var(--text-muted)]">
            {step === 'input' && 'Step 1 of 3 · Connect'}
            {step === 'preview' && `Step 2 of 3 · ${selectedPaths.size} files selected`}
            {step === 'syncing' && 'Step 3 of 3 · Syncing'}
            {step === 'done' && 'All done'}
          </div>
          <div className="flex items-center gap-2">
            {step === 'preview' && (
              <button
                className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                onClick={() => { setStep('input'); setPreview(null); setError(''); }}
              >
                Back
              </button>
            )}
            {(step === 'input' || step === 'preview') && (
              <button
                className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                onClick={handleClose}
              >
                Cancel
              </button>
            )}
            {step === 'input' && (
              <button
                disabled={isLoading || !repoUrl.trim()}
                className="h-9 px-4 rounded-lg bg-[var(--accent-primary)] text-white text-[13px] font-medium hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer transition-all inline-flex items-center gap-2"
                onClick={handlePreview}
              >
                {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                <span>{isLoading ? 'Scanning…' : 'Scan Repository'}</span>
              </button>
            )}
            {step === 'preview' && (
              <button
                disabled={selectedPaths.size === 0}
                className="h-9 px-4 rounded-lg bg-[var(--accent-primary)] text-white text-[13px] font-medium hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer transition-all inline-flex items-center gap-2"
                onClick={handleSync}
              >
                <FolderGit2 size={14} />
                <span>Sync {selectedPaths.size} File(s)</span>
                <ChevronRight size={13} />
              </button>
            )}
            {step === 'done' && (
              <button
                className="h-9 px-4 rounded-lg bg-[var(--accent-primary)] text-white text-[13px] font-medium hover:opacity-90 active:scale-[0.98] shadow-xs cursor-pointer transition-all"
                onClick={handleClose}
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

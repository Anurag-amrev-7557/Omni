import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { SidecarReader } from './components/layout/SidecarReader';
import { ChatCanvas } from './components/chat/ChatCanvas';
import { KnowledgeVault } from './components/vault/KnowledgeVault';
import { SettingsModal } from './components/modals/SettingsModal';
import { SearchModal } from './components/modals/SearchModal';
import { ShareModal } from './components/modals/ShareModal';
import { ProjectsModal } from './components/modals/ProjectsModal';
import { ProjectsView } from './components/projects/ProjectsView';
import { Toast } from './components/common/Toast';
import { useDocuments } from './hooks/useDocuments';
import { useSpeech } from './hooks/useSpeech';
import { api, API_BASE, setAuthTokenProvider } from './services/api';
import { supabase } from './lib/supabase';
import { ChatSession, ChatMessage } from './types/chat';
import { ProjectItem, INITIAL_PROJECTS } from './types/project';

export default function App() {
  useEffect(() => {
    setAuthTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);
  }, []);
  // Navigation & Layout State
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'chats' | 'projects' | 'vault' | 'chats_list'>('chats');
  const [sidecarOpen, setSidecarOpen] = useState<boolean>(false);
  const [sidecarDoc, setSidecarDoc] = useState<{ filename: string; content?: string } | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(false);

  // Projects State
  const [projects, setProjects] = useState<ProjectItem[]>(() => {
    const saved = localStorage.getItem('omni_projects');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return INITIAL_PROJECTS;
  });
  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    return localStorage.getItem('omni_active_project') || 'default-vault';
  });

  // Chat & Session State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  // Model & Inference Settings
  const [selectedModel, setSelectedModel] = useState<string>('GPT-OSS 120B');
  const [effortLevel, setEffortLevel] = useState<string>('Medium');
  const [temperature, setTemperature] = useState<number>(0.2);
  const [similarityTopK, setSimilarityTopK] = useState<number>(12);
  const [rerankLimit, setRerankLimit] = useState<number>(3);

  // Modals
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [shareOpen, setShareOpen] = useState<boolean>(false);
  const [projectsOpen, setProjectsOpen] = useState<boolean>(false);
  const [referencedVaultDocs, setReferencedVaultDocs] = useState<string[]>([]);

  // Toast (Debounced, cleanly transitions without spamming)
  const [toastMessage, setToastMessage] = useState<string>('');
  const toastTimeoutRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    if (!msg) return;
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(msg);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage('');
      toastTimeoutRef.current = null;
    }, 2400);
  }, []);

  // Custom Hooks
  const {
    documents,
    stats,
    health,
    isUploading,
    refreshVault,
    uploadFiles,
    deleteDocument,
    reindexDocument,
    downloadDocument,
    batchDeleteDocuments,
    batchReindexDocuments,
    batchDownloadDocuments,
    cleanupOrphaned,
  } = useDocuments(showToast);

  const { speakText, startVoiceDictation } = useSpeech(showToast);

  // Fetch Sessions
  const loadSessions = useCallback(async () => {
    try {
      const sess = await api.getSessions();
      setSessions(sess);
      if (sess.length > 0 && !currentSessionId) {
        setCurrentSessionId(sess[0].session_id);
      }
    } catch (e) {
      console.error("Error loading sessions:", e);
    }
  }, [currentSessionId]);

  // Fetch Messages for active session
  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const msgs = await api.getMessages(sessionId);
      setMessages(msgs);
    } catch (e) {
      console.error("Error loading messages:", e);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId);
    }
  }, [currentSessionId, loadMessages]);

  // Create New Thread (Instant 0ms UI switch with optimistic state)
  const handleNewChat = () => {
    const tempId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}`;
    setCurrentSessionId(tempId);
    setMessages([]);
    setInputPrompt('');
    setReferencedVaultDocs([]);
    setAttachedFiles([]);
    setActiveTab('chats');
    showToast("Started new chat");

    setSessions(prev => {
      if (prev.some(s => s.session_id === tempId)) return prev;
      return [{ session_id: tempId, title: 'New Chat', created_at: new Date().toISOString() }, ...prev];
    });

    // Non-blocking background sync
    api.createSession('New Chat').catch(() => {});
  };

  // Delete Thread
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId);
      const remaining = sessions.filter(s => s.session_id !== sessionId);
      setSessions(remaining);
      showToast("Thread deleted");
      if (remaining.length > 0) {
        setCurrentSessionId(remaining[0].session_id);
      } else {
        handleNewChat();
      }
    } catch (e) {
      console.error("Error deleting session:", e);
    }
  };

  // Inspect document in sidecar reader
  const handleInspectDoc = (doc: { filename: string; content?: string }) => {
    setSidecarDoc(doc);
    setSidecarOpen(true);
  };

  // Project Management Handlers
  const handleCreateProject = (name: string, description: string, color: string) => {
    const newProject: ProjectItem = {
      id: `proj-${Date.now()}`,
      name,
      description,
      documentCount: 0,
      chatCount: 0,
      createdAt: new Date().toISOString().split('T')[0],
      color,
    };
    const updated = [newProject, ...projects];
    setProjects(updated);
    localStorage.setItem('omni_projects', JSON.stringify(updated));
    setActiveProjectId(newProject.id);
    localStorage.setItem('omni_active_project', newProject.id);
  };

  const handleDeleteProject = (id: string) => {
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    localStorage.setItem('omni_projects', JSON.stringify(updated));
    if (activeProjectId === id) {
      setActiveProjectId('default-vault');
      localStorage.setItem('omni_active_project', 'default-vault');
    }
  };

  // Handle Send Prompt with SSE Streaming
  const handleSendPrompt = async (customText?: string) => {
    const text = customText || inputPrompt;
    if (!text.trim() && attachedFiles.length === 0) return;
    if (isStreaming || !currentSessionId) return;

    if (attachedFiles.length > 0) {
      await uploadFiles(attachedFiles);
      setAttachedFiles([]);
    }

    let actualPrompt = text.trim();
    if (referencedVaultDocs.length > 0) {
      const refHeader = `[Focus explicitly on referenced Knowledge Vault documents: ${referencedVaultDocs.join(', ')}]\n\n`;
      actualPrompt = actualPrompt ? `${refHeader}${actualPrompt}` : `${refHeader}Analyze and summarize key findings from the referenced documents.`;
      setReferencedVaultDocs([]);
    } else if (!actualPrompt) {
      actualPrompt = "Summarize the attached files.";
    }

    setInputPrompt('');
    setIsStreaming(true);

    const userMsg: ChatMessage = { role: 'user', content: actualPrompt };
    const tempAssistantMsg: ChatMessage = { role: 'assistant', content: '', contexts: null };
    setMessages(prev => [...prev, userMsg, tempAssistantMsg]);

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          session_id: currentSessionId,
          prompt: actualPrompt,
          web_search: webSearchEnabled
        })
      });

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let targetContent = '';
      let streamContexts: any = null;
      let thoughtContent: string | undefined = undefined;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'thought' && parsed.step) {
                thoughtContent = parsed.step;
              }
              if (parsed.token) {
                targetContent += parsed.token;
              }
              if (parsed.full_text && !targetContent) {
                targetContent = parsed.full_text;
              }
              if (parsed.contexts) {
                streamContexts = parsed.contexts;
              }
              setMessages(prev => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    content: targetContent,
                    thought: thoughtContent,
                    contexts: streamContexts || updated[lastIdx].contexts
                  };
                }
                return updated;
              });
            } catch {
              // Ignore partial unparsed chunks
            }
          }
        }
      }

      // Ensure assistant message has content if stream finished empty
      if (!targetContent.trim()) {
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content) {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: "I could not retrieve matching information. Please try rephrasing or enable Web Search.",
            };
          }
          return updated;
        });
      }

      loadSessions();
    } catch (e) {
      console.error("Stream error:", e);
      showToast("Error generating response");
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content) {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: "⚠️ *An error occurred while connecting to the assistant. Please try again.*",
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const activeSession = sessions.find(s => s.session_id === currentSessionId);
  const activeTitle = activeSession?.title || 'New chat';

  const handleExportChat = () => {
    if (messages.length === 0) {
      showToast("No messages to export");
      return;
    }
    let md = `# Omni RAG Chat Export - ${activeTitle || 'Chat'}\n*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;
    messages.forEach((m) => {
      md += `### ${m.role === 'user' ? '👤 User' : '🤖 Omni Assistant'}\n\n${m.content}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeTitle = (activeTitle || 'chat').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    link.setAttribute('download', `omni-chat-${safeTitle}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Chat exported to Markdown');
  };

  return (
    <div className="omni-layout font-sans">
      {/* Toast Notifications */}
      <Toast message={toastMessage} />

      {/* Left Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={(id) => setCurrentSessionId(id)}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProjects={() => setProjectsOpen(true)}
        documentsCount={documents.length || stats.files_count}
        totalChunksCount={stats.total_chunks}
        showToast={showToast}
      />

      {/* Main App Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-dark)]">
        {/* Top Header Bar */}
        <TopHeader
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={() => setSidebarCollapsed(false)}
          activeSessionTitle={activeTitle}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenShare={() => setShareOpen(true)}
          onExportChat={handleExportChat}
          hasMessages={messages.length > 0 && (activeTab === 'chats' || activeTab === 'chats_list')}
        />

        {/* Tab Switcher Body with Sidecar Support */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main Active Tab View (Smooth Synchronized Width Transition with Sidecar) */}
          <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
            {/* CHATS TAB */}
            {(activeTab === 'chats' || activeTab === 'chats_list') && (
              <ChatCanvas
                messages={messages}
                sessionId={currentSessionId}
                isStreaming={isStreaming}
                inputPrompt={inputPrompt}
                setInputPrompt={setInputPrompt}
                attachedFiles={attachedFiles}
                onRemoveAttachedFile={(target) => {
                  if (typeof target === 'number') {
                    setAttachedFiles(prev => prev.filter((_, i) => i !== target));
                  } else {
                    setAttachedFiles(prev => prev.filter(f => f !== target));
                  }
                }}
                onAttachFiles={(files) => {
                  if (!files) return;
                  const incoming = Array.from(files);
                  setAttachedFiles(prev => {
                    const existingSet = new Set(prev.map(f => `${f.name}_${f.size}_${f.lastModified}`));
                    const uniqueIncoming = incoming.filter(f => !existingSet.has(`${f.name}_${f.size}_${f.lastModified}`));
                    return [...prev, ...uniqueIncoming];
                  });
                }}
                vaultDocuments={documents}
                referencedVaultDocs={referencedVaultDocs}
                onAddReferencedDoc={(fn) => setReferencedVaultDocs(prev => prev.includes(fn) ? prev : [...prev, fn])}
                onRemoveReferencedDoc={(fn) => setReferencedVaultDocs(prev => prev.filter(f => f !== fn))}
                onSend={handleSendPrompt}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                effortLevel={effortLevel}
                setEffortLevel={setEffortLevel}
                webSearchEnabled={webSearchEnabled}
                onToggleWebSearch={() => {
                  setWebSearchEnabled(prev => {
                    const next = !prev;
                    showToast(next ? "🌐 Live Web Research Enabled" : "📁 Local Knowledge Vault Only");
                    return next;
                  });
                }}
                onInspectDoc={handleInspectDoc}
                onReadAloud={(text) => speakText(text)}
                onStartVoice={() => startVoiceDictation((t) => setInputPrompt(prev => `${prev} ${t}`.trim()))}
                showToast={showToast}
              />
            )}

            {/* PROJECTS TAB */}
            {activeTab === 'projects' && (
              <ProjectsView
                projects={projects}
                activeProjectId={activeProjectId}
                onSelectProject={(id) => {
                  setActiveProjectId(id);
                  localStorage.setItem('omni_active_project', id);
                }}
                onCreateProject={handleCreateProject}
                onDeleteProject={handleDeleteProject}
                onOpenVault={() => setActiveTab('vault')}
                onStartChatInProject={(projectId) => {
                  setActiveProjectId(projectId);
                  localStorage.setItem('omni_active_project', projectId);
                  handleNewChat();
                }}
                documents={documents}
                showToast={showToast}
              />
            )}

            {/* KNOWLEDGE VAULT TAB */}
            {activeTab === 'vault' && (
              <KnowledgeVault
                documents={documents}
                stats={stats}
                health={health}
                isUploading={isUploading}
                onUpload={uploadFiles}
                onRefresh={refreshVault}
                onInspect={handleInspectDoc}
                onDownload={downloadDocument}
                onReindex={reindexDocument}
                onDelete={deleteDocument}
                onBatchDelete={batchDeleteDocuments}
                onBatchReindex={batchReindexDocuments}
                onBatchDownload={batchDownloadDocuments}
                onCleanupOrphaned={cleanupOrphaned}
                showToast={showToast}
              />
            )}
          </div>

          {/* 50% SPLIT SIDECAR READER */}
          <SidecarReader
            isOpen={sidecarOpen}
            onClose={() => setSidecarOpen(false)}
            document={sidecarDoc}
          />
        </div>
      </main>

      {/* Global Modals */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        temperature={temperature}
        setTemperature={setTemperature}
        similarityTopK={similarityTopK}
        setSimilarityTopK={setSimilarityTopK}
        rerankLimit={rerankLimit}
        setRerankLimit={setRerankLimit}
        onResetCollection={async () => {
          if (!window.confirm("Purge all vector embeddings in Qdrant?")) return;
          await api.resetCollection();
          await refreshVault();
          showToast("Vector database reset");
        }}
        showToast={showToast}
      />

      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        sessions={sessions}
        documents={documents}
        onSelectSession={(id) => {
          setCurrentSessionId(id);
          setActiveTab('chats');
        }}
        onSelectDocument={(doc) => {
          handleInspectDoc({ filename: doc.filename });
        }}
        onNavigateTab={(tab) => {
          setActiveTab(tab);
        }}
        onOpenSettings={() => {
          setSettingsOpen(true);
        }}
        onNewChat={handleNewChat}
      />

      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        sessionTitle={activeTitle}
        showToast={showToast}
      />

      <ProjectsModal
        isOpen={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        showToast={showToast}
      />
    </div>
  );
}

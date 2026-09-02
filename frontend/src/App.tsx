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
import { AuthPage } from './components/auth/AuthPage';
import { Toast } from './components/common/Toast';
import { useDocuments } from './hooks/useDocuments';
import { useSpeech } from './hooks/useSpeech';
import { api, API_BASE, setAuthTokenProvider } from './services/api';
import { supabase } from './lib/supabase';
import { ChatSession, ChatMessage } from './types/chat';
import { ProjectItem, INITIAL_PROJECTS } from './types/project';

export default function App() {
  const [currentUser, setCurrentUser] = useState<unknown | null>(null);
  const [authOpen, setAuthOpen] = useState<boolean>(false);
  const [authReason, setAuthReason] = useState<string | undefined>(undefined);
  const [guestQueryCount, setGuestQueryCount] = useState<number>(() => {
    return parseInt(localStorage.getItem('omni_guest_queries') || '0', 10);
  });
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  useEffect(() => {
    setAuthTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);
    supabase.auth.getUser().then(({ data }) => setCurrentUser(data.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) {
        setAuthOpen(false);
        setAuthReason(undefined);
      }
    });
    return () => listener.subscription.unsubscribe();
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
  const [activeStreamingIds, setActiveStreamingIds] = useState<Set<string>>(new Set());
  const isStreaming = Boolean(currentSessionId && activeStreamingIds.has(currentSessionId));

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

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2400);
  }, []);

  // Custom Hooks
  const {
    documents,
    stats,
    health,
    isLoading,
    isUploading,
    refreshVault,
    uploadFiles,
    cancelUpload,
    deleteDocument,
    reindexDocument,
    downloadDocument,
    batchDeleteDocuments,
    batchReindexDocuments,
    batchDownloadDocuments,
    cleanupOrphaned,
  } = useDocuments(showToast);

  const { speakText, startVoiceDictation } = useSpeech(showToast);

  // In-memory message cache for instant 0ms chat window transitions
  const messageCacheRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const [isSessionsLoading, setIsSessionsLoading] = useState<boolean>(true);
  const [isMessagesLoading, setIsMessagesLoading] = useState<boolean>(false);

  // Keep currentSessionId in ref so session reloads don't re-trigger on chat clicks
  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Switch Session Instantly
  const handleSelectSession = useCallback((sessionId: string) => {
    if (!sessionId) return;
    currentSessionIdRef.current = sessionId;
    setCurrentSessionId(sessionId);
    setActiveTab('chats');
    setInputPrompt('');
    setReferencedVaultDocs([]);
    setAttachedFiles([]);

    const cached = messageCacheRef.current.get(sessionId);
    if (cached !== undefined) {
      setMessages(cached);
      setIsMessagesLoading(false);
    } else {
      setMessages([]);
      setIsMessagesLoading(true);
    }

    api.getMessages(sessionId).then((msgs) => {
      if (currentSessionIdRef.current === sessionId) {
        messageCacheRef.current.set(sessionId, msgs);
        setMessages(msgs);
      }
    }).finally(() => {
      if (currentSessionIdRef.current === sessionId) {
        setIsMessagesLoading(false);
      }
    });
  }, []);

  // Fetch Sessions
  const loadSessions = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setIsSessionsLoading(true);
      const sess = await api.getSessions();
      setSessions(sess);
      if (sess.length > 0 && !currentSessionIdRef.current) {
        handleSelectSession(sess[0].session_id);
      }
    } catch (e) {
      console.error("Error loading sessions:", e);
    } finally {
      if (isInitial) setIsSessionsLoading(false);
    }
  }, [handleSelectSession]);

  useEffect(() => {
    loadSessions(true);
  }, [loadSessions]);

  // Create New Thread
  const handleNewChat = useCallback(() => {
    const newSessionId = crypto.randomUUID();
    currentSessionIdRef.current = newSessionId;
    setCurrentSessionId(newSessionId);
    setMessages([]);
    messageCacheRef.current.set(newSessionId, []);
    setInputPrompt('');
    setReferencedVaultDocs([]);
    setAttachedFiles([]);
    setActiveTab('chats');
    showToast("Started new chat");
  }, [showToast]);

  // Delete Thread
  const handleDeleteSession = useCallback((sessionId: string) => {
    messageCacheRef.current.delete(sessionId);
    setSessions(prev => {
      const remaining = prev.filter(s => s.session_id !== sessionId);
      if (currentSessionIdRef.current === sessionId) {
        if (remaining.length > 0) handleSelectSession(remaining[0].session_id);
        else handleNewChat();
      }
      return remaining;
    });
    api.deleteSession(sessionId).catch(() => loadSessions(false));
  }, [handleSelectSession, handleNewChat, loadSessions]);

  // Project Management Handlers
  const handleCreateProject = (name: string, description: string, color: string) => {
    const newProject: ProjectItem = {
      id: `proj-${Date.now()}`,
      name,
      description,
      color,
      documentsCount: 0,
      conversationsCount: 0,
      createdAt: new Date().toISOString()
    };
    const updated = [newProject, ...projects];
    setProjects(updated);
    localStorage.setItem('omni_projects', JSON.stringify(updated));
    showToast(`Created project: ${name}`);
  };

  const handleSelectProject = (project: ProjectItem) => {
    setActiveProject(project);
    localStorage.setItem('omni_active_project', project.id);
    showToast(`Switched to project: ${project.name}`);
  };

  const handleDeleteProject = (id: string) => {
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    localStorage.setItem('omni_projects', JSON.stringify(updated));
    showToast("Project deleted");
    if (activeProject?.id === id) {
      setActiveProject(null);
      localStorage.setItem('omni_active_project', 'default-vault');
    }
  };

  // Handle Send Prompt with Concurrent Multi-Chat SSE Streaming
  const handleSendPrompt = async (customText?: string) => {
    const text = customText || inputPrompt;
    if (!text.trim() && attachedFiles.length === 0) return;
    const targetSessionId = currentSessionId;
    if (!targetSessionId || activeStreamingIds.has(targetSessionId)) return;

    if (!currentUser) {
      if (guestQueryCount >= 2) {
        setPendingPrompt(text);
        setAuthReason("You've completed your 2 free guest trial questions! Sign in with Google or Email to continue.");
        setAuthOpen(true);
        return;
      }
      const nextCount = guestQueryCount + 1;
      setGuestQueryCount(nextCount);
      localStorage.setItem('omni_guest_queries', nextCount.toString());
    }

    if (attachedFiles.length > 0) {
      await uploadFiles(attachedFiles);
      setAttachedFiles([]);
    }

    let actualPrompt = text.trim();
    if (referencedVaultDocs.length > 0) {
      const refHeader = `[Focus explicitly on referenced Knowledge Vault documents: ${referencedVaultDocs.join(', ')}]\n\n`;
      actualPrompt = `${refHeader}${actualPrompt}`;
      setReferencedVaultDocs([]);
    } else if (!actualPrompt) {
      actualPrompt = "Summarize the attached files.";
    }

    setInputPrompt('');

    const userMsg: ChatMessage = { role: 'user', content: actualPrompt };
    const tempAssistantMsg: ChatMessage = { role: 'assistant', content: '', contexts: null };

    const currentCached = messageCacheRef.current.get(targetSessionId) || [];
    const newSessionMessages = [...currentCached, userMsg, tempAssistantMsg];
    messageCacheRef.current.set(targetSessionId, newSessionMessages);

    if (currentSessionIdRef.current === targetSessionId) {
      setMessages(newSessionMessages);
    }

    setActiveStreamingIds(prev => new Set(prev).add(targetSessionId));

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          session_id: targetSessionId,
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
              if (parsed.type === 'title' && parsed.title) {
                const newTitle = parsed.title;
                setSessions(prev => {
                  const exists = prev.some(s => s.session_id === targetSessionId);
                  if (exists) {
                    return prev.map(s => s.session_id === targetSessionId ? { ...s, title: newTitle } : s);
                  }
                  return [{ session_id: targetSessionId, title: newTitle, created_at: new Date().toISOString() }, ...prev];
                });
              }
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

              const cached = messageCacheRef.current.get(targetSessionId) || [];
              const updated = [...cached];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: targetContent,
                  thought: thoughtContent,
                  contexts: streamContexts || updated[lastIdx].contexts
                };
              }
              messageCacheRef.current.set(targetSessionId, updated);

              if (currentSessionIdRef.current === targetSessionId) {
                setMessages(updated);
              }
            } catch {}
          }
        }
      }

      if (!targetContent.trim()) {
        const cached = messageCacheRef.current.get(targetSessionId) || [];
        const updated = [...cached];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content) {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: "I could not retrieve matching information. Please try rephrasing or enable Web Search.",
          };
        }
        messageCacheRef.current.set(targetSessionId, updated);
        if (currentSessionIdRef.current === targetSessionId) {
          setMessages(updated);
        }
      }

      loadSessions();
    } catch (e) {
      console.error("Stream error:", e);
      showToast("Error generating response");
      const cached = messageCacheRef.current.get(targetSessionId) || [];
      const updated = [...cached];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content) {
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: "⚠️ *An error occurred while connecting to the assistant. Please try again.*",
        };
      }
      messageCacheRef.current.set(targetSessionId, updated);
      if (currentSessionIdRef.current === targetSessionId) {
        setMessages(updated);
      }
    } finally {
      setActiveStreamingIds(prev => {
        const next = new Set(prev);
        next.delete(targetSessionId);
        return next;
      });
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
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProjects={() => setProjectsOpen(true)}
        documentsCount={documents.length || stats.files_count}
        totalChunksCount={stats.total_chunks}
        streamingSessionIds={activeStreamingIds}
        isLoadingSessions={isSessionsLoading}
        isStatsLoading={isLoading}
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
          onOpenAuth={() => {
            setAuthReason(undefined);
            setAuthOpen(true);
          }}
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
                isMessagesLoading={isMessagesLoading}
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
                isLoading={isLoading}
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
                onCancelUpload={cancelUpload}
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
        onSelectSession={handleSelectSession}
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

      {/* Claude-Style Split Screen Authentication Modal */}
      <AuthPage
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        reasonMessage={authReason}
        showToast={showToast}
        onSuccess={() => {
          setAuthOpen(false);
          if (pendingPrompt) {
            const p = pendingPrompt;
            setPendingPrompt(null);
            setTimeout(() => handleSendPrompt(p), 150);
          }
        }}
      />
    </div>
  );
}

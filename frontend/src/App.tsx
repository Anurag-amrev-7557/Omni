import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { SidecarReader } from './components/layout/SidecarReader';
import { ChatCanvas } from './components/chat/ChatCanvas';
import { KnowledgeVault } from './components/vault/KnowledgeVault';
import { SettingsModal, SettingsTabId } from './components/modals/SettingsModal';
import { SearchModal } from './components/modals/SearchModal';
import { ShareModal } from './components/modals/ShareModal';
import { ProjectsModal } from './components/modals/ProjectsModal';
import { ProjectsView } from './components/projects/ProjectsView';
import { KnowledgeGraphView } from './components/graph/KnowledgeGraphView';
import { AuthPage } from './components/auth/AuthPage';
import { Toast } from './components/common/Toast';
import { useDocuments } from './hooks/useDocuments';
import { useSpeech } from './hooks/useSpeech';
import { api, API_BASE, setAuthTokenProvider, getAuthToken, setCachedToken, getGuestSessionId } from './services/api';
import { supabase } from './lib/supabase';
import { ChatSession, ChatMessage } from './types/chat';
import { ProjectItem, INITIAL_PROJECTS } from './types/project';

export default function App() {
  // Navigation & Layout State
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'chats' | 'projects' | 'vault' | 'graph' | 'chats_list'>('chats');
  const [sidecarOpen, setSidecarOpen] = useState<boolean>(false);
  const [sidecarDoc, setSidecarDoc] = useState<{ filename: string; content?: string; page?: number } | null>(null);

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
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(() => {
    return localStorage.getItem('omni_web_search_enabled') === 'true';
  });
  const [temperature, setTemperature] = useState<number>(0.2);
  const [similarityTopK, setSimilarityTopK] = useState<number>(12);
  const [rerankLimit, setRerankLimit] = useState<number>(3);

  // Modals
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [shareOpen, setShareOpen] = useState<boolean>(false);
  const [projectsOpen, setProjectsOpen] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [referencedVaultDocs, setReferencedVaultDocs] = useState<string[]>([]);

  const handleOpenSettings = useCallback((tab: SettingsTabId = 'general') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  // Toast
  const [toastMessage, setToastMessage] = useState<string>('');
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 2600);
  }, []);

  // Custom Hooks
  const {
    documents,
    stats,
    isUploading,
    refreshVault,
    uploadFiles,
    addDocumentOptimistic,
    deleteDocument,
    reindexDocument,
    enhanceDocument,
    downloadDocument,
    batchDeleteDocuments,
    batchReindexDocuments,
    batchEnhanceDocuments,
    batchDownloadDocuments,
  } = useDocuments(showToast);

  const { speakText, startVoiceDictation } = useSpeech(showToast);

  // Fetch Sessions (stable callback with functional state updates to prevent re-render cascades)
  const loadSessions = useCallback(async () => {
    try {
      const sess = await api.getSessions();
      setSessions(sess);
      setCurrentSessionId(prev => (sess.length > 0 && !prev ? sess[0].session_id : prev));
    } catch (e) {
      console.error("Error loading sessions:", e);
    }
  }, []);

  // Fetch Messages for active session
  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const msgs = await api.getMessages(sessionId);
      setMessages(msgs);
    } catch (e) {
      console.error("Error loading messages:", e);
    }
  }, []);

  // Supabase Auth Integration (registered once on mount)
  useEffect(() => {
    if (supabase) {
      setAuthTokenProvider(async () => {
        try {
          const session = (await supabase.auth.getSession()).data.session;
          return session?.access_token ?? null;
        } catch {
          return null;
        }
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        const token = session?.access_token ?? null;
        setCachedToken(token);
        if (session) {
          setAuthModalOpen(false);
        }
        setCurrentSessionId(null);
        setMessages([]);
        refreshVault();
        loadSessions();
      });
      return () => listener.subscription.unsubscribe();
    }
  }, []); // Run once on mount

  // Ephemeral Guest Lifecycle: cleanup guest docs, vectors, chats and graph on exit
  useEffect(() => {
    const handleBeforeUnload = () => {
      // If user is not logged in with Supabase token, trigger guest cleanup
      const guestId = sessionStorage.getItem('omni_guest_session_id');
      const hasAuth = !!supabase && !!localStorage.getItem('sb-' + (supabase as any)?.supabaseUrl?.split('//')[1]?.split('.')[0] + '-auth-token');
      if (guestId && guestId.startsWith('guest_') && !hasAuth) {
        const cleanupUrl = `${API_BASE}/api/guest/cleanup?guest_id=${encodeURIComponent(guestId)}`;
        if (navigator.sendBeacon) {
          navigator.sendBeacon(cleanupUrl);
        } else {
          fetch(cleanupUrl, { method: 'POST', keepalive: true }).catch(() => {});
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId);
    }
  }, [currentSessionId, loadMessages]);

  // Create New Thread
  const handleNewChat = async () => {
    try {
      const newSess = await api.createSession('New chat');
      await loadSessions();
      setCurrentSessionId(newSess.session_id);
      setMessages([]);
      setActiveTab('chats');
      showToast("Started new chat");
    } catch (e) {
      console.error("Error creating session:", e);
    }
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
  const handleInspectDoc = (doc: { filename: string; content?: string; page?: number }) => {
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
  const handleSendPrompt = async (text: string = inputPrompt) => {
    if (!text.trim() && attachedFiles.length === 0) return;

    if (!currentSessionId) {
      try {
        const newSess = await api.createSession('New chat');
        await loadSessions();
        setCurrentSessionId(newSess.session_id);
      } catch (e) {
        showToast("Error creating chat session");
        return;
      }
    }

    let actualPrompt = text.trim();
    if (referencedVaultDocs.length > 0) {
      const refHeader = `[Focus explicitly on referenced Knowledge Vault documents: ${referencedVaultDocs.join(', ')}]\n\n`;
      actualPrompt = actualPrompt ? `${refHeader}${actualPrompt}` : `${refHeader}Analyze and summarize key findings from the referenced documents.`;
      setReferencedVaultDocs([]);
    } else if (!actualPrompt) {
      actualPrompt = "Summarize the attached files.";
    }

    if (attachedFiles.length > 0) {
      await uploadFiles(attachedFiles);
      setAttachedFiles([]);
    }

    setInputPrompt('');
    setIsStreaming(true);

    const userMsg: ChatMessage = { role: 'user', content: actualPrompt };
    const tempAssistantMsg: ChatMessage = { role: 'assistant', content: '', contexts: null };
    setMessages(prev => [...prev, userMsg, tempAssistantMsg]);

    try {
      const token = await getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token && token !== 'null' && token !== 'undefined') {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const customInstructions = localStorage.getItem('omni_custom_instructions') || '';

      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          session_id: currentSessionId, 
          prompt: actualPrompt, 
          model: selectedModel,
          custom_instructions: customInstructions,
          web_search: webSearchEnabled,
        })
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(errText || `Server returned HTTP ${response.status}`);
      }

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let targetContent = '';
      let streamContexts: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (dataStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.token) {
                targetContent += parsed.token;
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
                    contexts: streamContexts || updated[lastIdx].contexts
                  };
                }
                return updated;
              });
            } catch {
              targetContent += dataStr;
            }
          }
        }
      }

      // Safeguard against empty response hanging the loader
      if (!targetContent.trim()) {
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content) {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: "⚠️ *Unable to generate response. The model may have encountered a temporary rate limit. Please try again or switch model.*"
            };
          }
          return updated;
        });
      }

      loadSessions();
    } catch (e: any) {
      console.error("Stream error:", e);
      showToast("Error generating response: " + (e?.message || "Failed"));
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content) {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: "⚠️ *Connection error while generating response. Please check your connection and retry.*"
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
        onOpenSettings={handleOpenSettings}
        onOpenProjects={() => setProjectsOpen(true)}
        onOpenAuth={() => setAuthModalOpen(true)}
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
          onOpenSettings={handleOpenSettings}
          onOpenShare={() => setShareOpen(true)}
          onOpenAuth={() => setAuthModalOpen(true)}
        />

        {/* Tab Switcher Body with Sidecar Support */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main Active Tab View (Smooth Synchronized Width Transition with Sidecar) */}
          <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
            {/* CHATS TAB */}
            {(activeTab === 'chats' || activeTab === 'chats_list') && (
              <ChatCanvas
                messages={messages}
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
                    localStorage.setItem('omni_web_search_enabled', String(next));
                    showToast(next ? "Live Web Search enabled" : "Live Web Search disabled");
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
                isUploading={isUploading}
                onUpload={uploadFiles}
                onAddDocument={addDocumentOptimistic}
                onRefresh={refreshVault}
                onInspect={handleInspectDoc}
                onDownload={downloadDocument}
                onReindex={reindexDocument}
                onEnhance={enhanceDocument}
                onDelete={deleteDocument}
                onBatchDelete={batchDeleteDocuments}
                onBatchReindex={batchReindexDocuments}
                onBatchEnhance={batchEnhanceDocuments}
                onBatchDownload={batchDownloadDocuments}
                showToast={showToast}
              />
            )}

            {/* KNOWLEDGE GRAPH TAB */}
            {activeTab === 'graph' && (
              <KnowledgeGraphView
                onInspectDoc={handleInspectDoc}
                vaultVersion={documents.length}
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
        initialTab={settingsTab}
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
        onOpenSettings={handleOpenSettings}
        onNewChat={handleNewChat}
      />

      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        sessionId={currentSessionId || ''}
        sessionTitle={activeTitle}
        messagesCount={messages.length}
        showToast={showToast}
      />

      <AuthPage
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => setAuthModalOpen(false)}
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

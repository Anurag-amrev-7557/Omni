import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { api, API_BASE, setAuthTokenProvider, getAuthToken, setCachedToken, getGuestSessionId, clearUserDataOnLogout } from './services/api';
import { supabase } from './lib/supabase';
import { ChatSession, ChatMessage } from './types/chat';
import { ProjectItem, INITIAL_PROJECTS } from './types/project';

export default function App() {
  // Navigation & Layout State
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'chats' | 'projects' | 'vault' | 'graph' | 'chats_list'>(() => {
    try {
      const saved = localStorage.getItem('omni_active_tab');
      if (saved && ['chats', 'projects', 'vault', 'graph', 'chats_list'].includes(saved)) {
        return saved as any;
      }
    } catch {}
    return 'chats';
  });

  // Persist active tab across page refreshes
  useEffect(() => {
    try {
      localStorage.setItem('omni_active_tab', activeTab);
    } catch {}
  }, [activeTab]);

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

  // Chat & Session Helper: Get cached messages for instant display without waiting for network
  const getCachedMessages = (sessionId: string | null): ChatMessage[] => {
    if (!sessionId) return [];
    try {
      const cached = localStorage.getItem(`omni_msgs_${sessionId}`);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  };

  // Chat & Session State (Instant SWR hydration from cache)
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('omni_sessions_cache');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    try {
      const active = localStorage.getItem('omni_active_session_id');
      if (active) return active;
      const saved = localStorage.getItem('omni_sessions_cache');
      const parsed = saved ? JSON.parse(saved) : [];
      return parsed.length > 0 ? parsed[0].session_id : null;
    } catch {
      return null;
    }
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const active = localStorage.getItem('omni_active_session_id');
      const saved = localStorage.getItem('omni_sessions_cache');
      const parsed = saved ? JSON.parse(saved) : [];
      const initialId = active || (parsed.length > 0 ? parsed[0].session_id : null);
      return getCachedMessages(initialId);
    } catch {
      return [];
    }
  });

  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('omni_sessions_cache');
      const parsed = saved ? JSON.parse(saved) : [];
      return parsed.length === 0;
    } catch {
      return true;
    }
  });

  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(() => {
    try {
      const active = localStorage.getItem('omni_active_session_id');
      const saved = localStorage.getItem('omni_sessions_cache');
      const parsed = saved ? JSON.parse(saved) : [];
      const initialId = active || (parsed.length > 0 ? parsed[0].session_id : null);
      if (!initialId) return false;
      const cached = localStorage.getItem(`omni_msgs_${initialId}`);
      const msgs = cached ? JSON.parse(cached) : [];
      return msgs.length === 0;
    } catch {
      return false;
    }
  });

  const skipNextMessageLoadRef = useRef<string | null>(null);
  const previousUserIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef<boolean>(false);
  const activeSessionIdRef = useRef<string | null>(currentSessionId);

  // Keep activeSessionIdRef in sync with currentSessionId
  useEffect(() => {
    activeSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Sync sessions cache with localStorage on every update (including immediate deletions)
  useEffect(() => {
    try {
      localStorage.setItem('omni_sessions_cache', JSON.stringify(sessions));
    } catch {}
  }, [sessions]);

  // Persist active session ID across page refreshes
  useEffect(() => {
    try {
      if (currentSessionId) {
        localStorage.setItem('omni_active_session_id', currentSessionId);
      } else {
        localStorage.removeItem('omni_active_session_id');
      }
    } catch {}
  }, [currentSessionId]);

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
    isLoading: isDocsLoading,
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
    resetDocumentsState,
  } = useDocuments(showToast);

  const { speakText, startVoiceDictation } = useSpeech(showToast);

  // Fetch Sessions (stable callback with functional state updates to prevent re-render cascades)
  const loadSessions = useCallback(async () => {
    try {
      const sess = await api.getSessions();
      setSessions(prev => {
        // Preserve any optimistic sessions that the remote server hasn't committed yet
        const optimistic = prev.filter(p => !sess.some(s => s.session_id === p.session_id));
        return [...optimistic, ...sess];
      });
      try {
        localStorage.setItem('omni_sessions_cache', JSON.stringify(sess));
      } catch {}
      setCurrentSessionId(prev => {
        // Never hijack or switch sessions while user is streaming
        if (isStreamingRef.current) return prev;
        // If user intentionally navigated to New Chat (prev === null), preserve it!
        if (prev === null) return null;
        if (prev && sess.some(s => s.session_id === prev)) {
          return prev;
        }
        return prev || (sess.length > 0 ? sess[0].session_id : null);
      });
    } catch (e) {
      console.error("Error loading sessions:", e);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  // Fetch Messages for active session (with instant cache hydration)
  const loadMessages = useCallback(async (sessionId: string) => {
    if (isStreamingRef.current) return;
    if (sessionId !== activeSessionIdRef.current) return;

    const cached = getCachedMessages(sessionId);
    if (cached.length > 0) {
      setMessages(cached);
      setIsLoadingMessages(false);
    } else {
      setIsLoadingMessages(true);
    }
    try {
      const msgs = await api.getMessages(sessionId);
      if (isStreamingRef.current || sessionId !== activeSessionIdRef.current) {
        return;
      }
      setMessages(msgs);
      try {
        localStorage.setItem(`omni_msgs_${sessionId}`, JSON.stringify(msgs));
      } catch {}
    } catch (e) {
      console.error("Error loading messages:", e);
    } finally {
      if (sessionId === activeSessionIdRef.current) {
        setIsLoadingMessages(false);
      }
    }
  }, []);

  // Instant switch between sessions
  const handleSelectSession = useCallback((sessionId: string) => {
    if (sessionId === currentSessionId) return;
    if (isStreamingRef.current) return;
    setCurrentSessionId(sessionId);
    activeSessionIdRef.current = sessionId;
    const cached = getCachedMessages(sessionId);
    if (cached.length > 0) {
      setMessages(cached);
      setIsLoadingMessages(false);
    } else {
      setMessages([]);
      setIsLoadingMessages(true);
    }
  }, [currentSessionId]);

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
      // Proactive initial session sync
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id) {
          previousUserIdRef.current = session.user.id;
        }
        if (session?.access_token) {
          setCachedToken(session.access_token);
          refreshVault();
          loadSessions();
        }
      });
      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') return; // Handled by proactive initial sync
        const currentUserId = session?.user?.id ?? null;
        const token = session?.access_token ?? null;
        setCachedToken(token);
        if (session) {
          setAuthModalOpen(false);
        }
        // Wipe all user data, caches, and reset state if user logs out or switches accounts
        if (event === 'SIGNED_OUT' || currentUserId !== previousUserIdRef.current) {
          previousUserIdRef.current = currentUserId;
          clearUserDataOnLogout();
          setCurrentSessionId(null);
          setSessions([]);
          setMessages([]);
          setProjects(INITIAL_PROJECTS);
          setActiveProjectId('default-vault');
          setSidecarDoc(null);
          setSidecarOpen(false);
          resetDocumentsState();
          refreshVault();
          loadSessions();
        }
      });
      return () => listener.subscription.unsubscribe();
    }
  }, []); // Run once on mount

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (currentSessionId) {
      if (skipNextMessageLoadRef.current === currentSessionId) {
        skipNextMessageLoadRef.current = null;
        return;
      }
      loadMessages(currentSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  // Create New Thread (Instant local reset - creates remote thread on first prompt)
  const handleNewChat = () => {
    if (isStreamingRef.current) return;
    setCurrentSessionId(null);
    activeSessionIdRef.current = null;
    setMessages([]);
    try {
      localStorage.removeItem('omni_active_session_id');
    } catch {}
    setActiveTab('chats');
    showToast("Started new chat");
  };

  // Delete Thread (Optimistic UI with Rollback)
  const handleDeleteSession = async (sessionId: string) => {
    // Snapshot state for rollback
    const previousSessions = sessions;
    const previousSessionId = currentSessionId;

    try {
      localStorage.removeItem(`omni_msgs_${sessionId}`);
    } catch {}

    // Optimistically remove session immediately and persist to cache
    const remaining = sessions.filter(s => s.session_id !== sessionId);
    setSessions(remaining);
    try {
      localStorage.setItem('omni_sessions_cache', JSON.stringify(remaining));
    } catch {}
    showToast("Thread deleted");

    if (currentSessionId === sessionId) {
      if (remaining.length > 0) {
        handleSelectSession(remaining[0].session_id);
      } else {
        handleNewChat();
      }
    }

    try {
      await api.deleteSession(sessionId);
    } catch (e) {
      console.error("Error deleting session:", e);
      // Rollback on failure
      setSessions(previousSessions);
      setCurrentSessionId(previousSessionId);
      try {
        localStorage.setItem('omni_sessions_cache', JSON.stringify(previousSessions));
      } catch {}
      showToast("✗ Failed to delete thread");
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

  // Handle Send Prompt with SSE Streaming (Optimistic UI)
  const handleSendPrompt = async (text: string = inputPrompt) => {
    if (!text.trim() && attachedFiles.length === 0) return;

    // 1. Prepare actual prompt content
    let actualPrompt = text.trim();
    if (referencedVaultDocs.length > 0) {
      const refHeader = `[Focus explicitly on referenced Knowledge Vault documents: ${referencedVaultDocs.join(', ')}]\n\n`;
      actualPrompt = actualPrompt ? `${refHeader}${actualPrompt}` : `${refHeader}Analyze and summarize key findings from the referenced documents.`;
      setReferencedVaultDocs([]);
    } else if (!actualPrompt) {
      actualPrompt = "Summarize the attached files.";
    }

    // 2. Instantly clear input prompt & attached files (Zero delay)
    const filesToUpload = [...attachedFiles];
    setInputPrompt('');
    setAttachedFiles([]);

    // 3. Ensure an active session exists or create optimistic session immediately
    let activeSessId = currentSessionId;
    if (!activeSessId) {
      // Generate standard RFC4122 UUID so Postgres and client always agree
      activeSessId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      skipNextMessageLoadRef.current = activeSessId;
      activeSessionIdRef.current = activeSessId;
      const sessionTitle = actualPrompt.slice(0, 32).trim() || 'New chat';
      const optimisticSession: ChatSession = {
        session_id: activeSessId,
        title: sessionTitle,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 1
      };
      setSessions(prev => [optimisticSession, ...prev]);
      setCurrentSessionId(activeSessId);

      // Create remote session with this exact ID (no swapping!)
      api.createSession(sessionTitle, activeSessId).catch(err => {
        console.warn("Could not proactively create remote session:", err);
      });
    } else {
      activeSessionIdRef.current = activeSessId;
      // Optimistically update session title in sidebar if it was generic
      const truncatedTitle = actualPrompt.slice(0, 32).trim();
      if (truncatedTitle) {
        setSessions(prev => 
          prev.map(s => {
            if (s.session_id === activeSessId && (s.title === 'New chat' || s.title === 'Untitled chat' || !s.title)) {
              return { ...s, title: truncatedTitle };
            }
            return s;
          })
        );
      }
    }

    // 4. Instantly append user message and streaming assistant placeholder
    const userMsg: ChatMessage = { role: 'user', content: actualPrompt };
    const tempAssistantMsg: ChatMessage = { role: 'assistant', content: '', contexts: null };
    setMessages(prev => [...prev, userMsg, tempAssistantMsg]);
    setIsStreaming(true);
    isStreamingRef.current = true;

    // 5. If files were attached, initiate ingestion concurrently
    if (filesToUpload.length > 0) {
      uploadFiles(filesToUpload);
    }

    try {
      const token = await getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token && token !== 'null' && token !== 'undefined') {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        headers['X-Guest-Id'] = getGuestSessionId();
      }

      const customInstructions = localStorage.getItem('omni_custom_instructions') || '';

      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          session_id: activeSessId, 
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
              let statusUpdate: string | undefined = undefined;

              // Handle status events emitted by backend during retrieval/web search
              if (parsed.type === 'status' || parsed.status || (parsed.message && !parsed.token && !parsed.contexts)) {
                statusUpdate = parsed.message || parsed.status || '';
              }

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
                    contexts: streamContexts || updated[lastIdx].contexts,
                    ...(statusUpdate !== undefined ? { statusMessage: statusUpdate } : {})
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

      // Persist completed conversation into local cache for instant retrieval
      setMessages(prev => {
        try {
          localStorage.setItem(`omni_msgs_${activeSessId}`, JSON.stringify(prev));
        } catch {}
        return prev;
      });

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
      isStreamingRef.current = false;
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
        onSelectSession={handleSelectSession}
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
        isLoadingSessions={isLoadingSessions}
        isLoadingDocuments={isDocsLoading && documents.length === 0}
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
                currentSessionId={currentSessionId}
                messages={messages}
                isStreaming={isStreaming}
                isLoadingMessages={isLoadingMessages}
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

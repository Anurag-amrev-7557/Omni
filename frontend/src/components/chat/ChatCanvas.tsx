import React, { useRef, useEffect, useState } from 'react';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { ChatMessage } from '../../types/chat';
import { DocumentItem } from '../../types/document';
import { Skeleton } from '../common/Skeleton';

interface ChatCanvasProps {
  messages: ChatMessage[];
  sessionId?: string | null;
  isStreaming: boolean;
  isMessagesLoading?: boolean;
  inputPrompt: string;
  setInputPrompt: (val: string) => void;
  attachedFiles: File[];
  onRemoveAttachedFile: (fileOrIndex: File | number) => void;
  onAttachFiles: (files: FileList | null) => void;
  vaultDocuments?: DocumentItem[];
  referencedVaultDocs?: string[];
  onAddReferencedDoc?: (filename: string) => void;
  onRemoveReferencedDoc?: (filename: string) => void;
  onSend: (text?: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  effortLevel: string;
  setEffortLevel: (effort: string) => void;
  webSearchEnabled?: boolean;
  onToggleWebSearch?: () => void;
  onInspectDoc: (chunk: { filename: string; content?: string }) => void;
  onReadAloud: (content: string) => void;
  onStartVoice: () => void;
  showToast: (msg: string) => void;
}

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  messages,
  sessionId,
  isStreaming,
  isMessagesLoading = false,
  inputPrompt,
  setInputPrompt,
  attachedFiles,
  onRemoveAttachedFile,
  onAttachFiles,
  vaultDocuments = [],
  referencedVaultDocs = [],
  onAddReferencedDoc,
  onRemoveReferencedDoc,
  onSend,
  selectedModel,
  setSelectedModel,
  effortLevel,
  setEffortLevel,
  webSearchEnabled,
  onToggleWebSearch,
  onInspectDoc,
  onReadAloud,
  onStartVoice,
  showToast,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const prevSessionIdRef = useRef<string | null | undefined>(sessionId);
  const prevMessagesLengthRef = useRef<number>(messages.length);
  const [isWakingUp, setIsWakingUp] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    if (isMessagesLoading && messages.length === 0) {
      timer = window.setTimeout(() => {
        setIsWakingUp(true);
      }, 3000);
    } else {
      setIsWakingUp(false);
    }
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isMessagesLoading, messages.length]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If user scrolled up by more than 60px, pause stream auto-pinning
    userScrolledUpRef.current = distanceToBottom > 60;
  };

  // Instant 0ms scroll to bottom on session switch
  useEffect(() => {
    const isSessionSwitch = prevSessionIdRef.current !== sessionId;
    prevSessionIdRef.current = sessionId;
    userScrolledUpRef.current = false;

    if (isSessionSwitch && scrollContainerRef.current) {
      // Teleport instantly to bottom without visible top-to-bottom travel
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [sessionId]);

  useEffect(() => {
    if (userScrolledUpRef.current) return;

    const el = scrollContainerRef.current;
    if (!el) return;

    const isNewThreadLoad = prevMessagesLengthRef.current === 0 && messages.length > 0;
    prevMessagesLengthRef.current = messages.length;

    // Instant position when messages first load into empty view
    if (isNewThreadLoad) {
      el.scrollTop = el.scrollHeight;
      return;
    }

    if (isStreaming) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (el && !userScrolledUpRef.current) {
          // Butter-smooth hardware viewport lock to streaming tail (matches Claude & ChatGPT 120Hz behavior)
          el.scrollTop = el.scrollHeight;
        }
      });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [messages, isStreaming]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-dark)]">
      {/* Scrollable Message Feed */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 pb-6"
      >
        <div className="max-w-4xl mx-auto w-full">
          {/* Subtle Conversation Skeleton Loader during Thread Fetch */}
          {isMessagesLoading && messages.length === 0 && (
            <div className="space-y-6 pt-6 fade-in">
              {/* User message skeleton */}
              <div className="flex justify-end">
                <div className="max-w-[70%] sm:max-w-[50%] w-full rounded-2xl p-4 bg-[var(--bg-user-bubble)] border border-[var(--border-color)] space-y-2.5">
                  <Skeleton className="h-3.5 w-4/5 rounded-md" />
                  <Skeleton className="h-3.5 w-3/5 rounded-md" />
                </div>
              </div>

              {/* Assistant response skeleton */}
              <div className="flex gap-3.5 items-start">
                <Skeleton className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2.5 max-w-[85%]">
                  <Skeleton className="h-3.5 w-24 rounded-md" />
                  <Skeleton className="h-3.5 w-full rounded-md" />
                  <Skeleton className="h-3.5 w-11/12 rounded-md" />
                  <Skeleton className="h-3.5 w-4/5 rounded-md" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-6 w-28 rounded-lg" />
                    <Skeleton className="h-6 w-32 rounded-lg" />
                  </div>
                </div>
              </div>

              {/* Second user message skeleton */}
              <div className="flex justify-end pt-2">
                <div className="max-w-[55%] sm:max-w-[40%] w-full rounded-2xl p-4 bg-[var(--bg-user-bubble)] border border-[var(--border-color)] space-y-2">
                  <Skeleton className="h-3.5 w-3/4 rounded-md" />
                </div>
              </div>

              {/* Second assistant response skeleton */}
              <div className="flex gap-3.5 items-start">
                <Skeleton className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2.5 max-w-[80%]">
                  <Skeleton className="h-3.5 w-24 rounded-md" />
                  <Skeleton className="h-3.5 w-full rounded-md" />
                  <Skeleton className="h-3.5 w-3/4 rounded-md" />
                </div>
              </div>

              {/* Honest UI: Cold start notification */}
              {isWakingUp && (
                <div className="flex items-center justify-center gap-2 py-4 px-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-500 font-medium fade-in">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                  <span>Waking up the free-tier server... This first request may take up to 45 seconds.</span>
                </div>
              )}
            </div>
          )}

          {/* Welcome Banner when empty and not loading */}
          {!isMessagesLoading && messages.length === 0 && (
            <div className="text-center mt-20 mb-12 fade-in select-none">
              <h1 className="font-serif text-4xl font-normal text-[var(--text-main)] mb-3 tracking-tight">
                How can Omni help you today?
              </h1>
              <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
                Ask multi-document questions, synthesize research findings, or extract grounded citations from your vault.
              </p>
            </div>
          )}

          {/* Message List */}
          {messages.map((msg, idx) => (
            <MessageItem
              key={idx}
              message={msg}
              sessionId={sessionId || undefined}
              isLastAssistant={idx === messages.length - 1 && msg.role === 'assistant'}
              isStreaming={isStreaming}
              onRetry={(text) => onSend(text)}
              onEdit={(text) => setInputPrompt(text)}
              onInspectDoc={onInspectDoc}
              onReadAloud={onReadAloud}
              showToast={showToast}
            />
          ))}
          <div ref={bottomRef} className="h-4" />
        </div>
      </div>

      {/* Docked Bottom Input Area with Smooth Upward Gradient Fade */}
      <div className="flex-shrink-0 relative z-20 bg-[var(--bg-dark)] pb-4 pt-1 px-4 sm:px-6">
        <div className="absolute inset-x-0 bottom-full h-14 pointer-events-none bg-gradient-to-t from-[var(--bg-dark)] to-transparent" />

        <div className="w-full max-w-4xl mx-auto">
          <ChatInput
            inputPrompt={inputPrompt}
            setInputPrompt={setInputPrompt}
            attachedFiles={attachedFiles}
            onRemoveAttachedFile={onRemoveAttachedFile}
            onAttachFiles={onAttachFiles}
            vaultDocuments={vaultDocuments}
            referencedVaultDocs={referencedVaultDocs}
            onAddReferencedDoc={onAddReferencedDoc}
            onRemoveReferencedDoc={onRemoveReferencedDoc}
            isStreaming={isStreaming}
            onSend={() => onSend()}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            effortLevel={effortLevel}
            setEffortLevel={setEffortLevel}
            webSearchEnabled={webSearchEnabled}
            onToggleWebSearch={onToggleWebSearch}
            onStartVoice={onStartVoice}
            showToast={showToast}
          />
        </div>
      </div>
    </div>
  );
};

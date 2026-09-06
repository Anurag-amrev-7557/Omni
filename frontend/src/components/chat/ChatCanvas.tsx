import React, { useRef, useEffect } from 'react';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { ChatMessage } from '../../types/chat';

import { DocumentItem } from '../../types/document';

interface ChatCanvasProps {
  currentSessionId?: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  isLoadingMessages?: boolean;
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
  onInspectDoc: (chunk: { filename: string; content?: string; page?: number }) => void;
  onReadAloud: (content: string) => void;
  onStartVoice: () => void;
  showToast: (msg: string) => void;
}

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  currentSessionId = null,
  messages,
  isStreaming,
  isLoadingMessages = false,
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
  webSearchEnabled = false,
  onToggleWebSearch,
  onInspectDoc,
  onReadAloud,
  onStartVoice,
  showToast,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-dark)]">
      {/* Scrollable Message Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 pb-6 scroll-smooth">
        <div className="max-w-4xl mx-auto w-full">
          {/* Loading Skeleton when switching sessions */}
          {isLoadingMessages && messages.length === 0 ? (
            <div className="flex flex-col gap-6 py-4 animate-in fade-in duration-200">
              {/* User Prompt Skeleton */}
              <div className="flex justify-end">
                <div className="max-w-[70%] rounded-2xl rounded-tr-xs bg-[var(--bg-card)] border border-[var(--border-color)] px-4 py-3 shadow-xs animate-pulse flex flex-col gap-2">
                  <div className="h-3.5 w-48 rounded bg-[var(--border-color)]/70" />
                  <div className="h-3.5 w-32 rounded bg-[var(--border-color)]/50" />
                </div>
              </div>

              {/* Assistant Response Skeleton */}
              <div className="flex gap-3.5 items-start">
                <div className="w-7 h-7 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center flex-shrink-0 animate-pulse">
                  <div className="w-3.5 h-3.5 rounded-full bg-[var(--accent-primary)]/40" />
                </div>
                <div className="flex-1 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] p-4 shadow-xs animate-pulse flex flex-col gap-3 max-w-2xl">
                  <div className="h-3.5 w-full rounded bg-[var(--border-color)]/70" />
                  <div className="h-3.5 w-[85%] rounded bg-[var(--border-color)]/60" />
                  <div className="h-3.5 w-[70%] rounded bg-[var(--border-color)]/50" />
                  <div className="h-3.5 w-[90%] rounded bg-[var(--border-color)]/60" />
                  
                  {/* Context pills skeleton */}
                  <div className="flex gap-2 pt-2 border-t border-[var(--border-color)]">
                    <div className="h-5 w-28 rounded-full bg-[var(--bg-input)]" />
                    <div className="h-5 w-36 rounded-full bg-[var(--bg-input)]" />
                  </div>
                </div>
              </div>
            </div>
          ) : messages.length === 0 ? (
            currentSessionId ? (
              <div className="text-center mt-20 mb-12 fade-in select-none">
                <h1 className="font-serif text-3xl font-normal text-[var(--text-main)] mb-2.5 tracking-tight">
                  Thread Ready
                </h1>
                <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
                  Ask a question, analyze your vault documents, or begin this conversation.
                </p>
              </div>
            ) : (
              <div className="text-center mt-20 mb-12 fade-in select-none">
                <h1 className="font-serif text-4xl font-normal text-[var(--text-main)] mb-3 tracking-tight">
                  How can Omni help you today?
                </h1>
                <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
                  Ask multi-document questions, synthesize research findings, or extract grounded citations from your vault.
                </p>
              </div>
            )
          ) : null}

          {/* Message List */}
          {messages.map((msg, idx) => (
            <MessageItem
              key={idx}
              message={msg}
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
        {/* Soft, Seamless Gradient Fade Overlay directly above the input boundary */}
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

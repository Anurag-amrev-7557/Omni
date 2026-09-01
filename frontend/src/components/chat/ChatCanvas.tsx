import React, { useRef, useEffect } from 'react';
import { Download } from 'lucide-react';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { ChatMessage } from '../../types/chat';
import { DocumentItem } from '../../types/document';

interface ChatCanvasProps {
  messages: ChatMessage[];
  sessionId?: string | null;
  isStreaming: boolean;
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
  onInspectDoc: (chunk: { filename: string; content?: string }) => void;
  onReadAloud: (content: string) => void;
  onStartVoice: () => void;
  showToast: (msg: string) => void;
}

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  messages,
  sessionId,
  isStreaming,
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
  onInspectDoc,
  onReadAloud,
  onStartVoice,
  showToast,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleExportMarkdown = () => {
    if (messages.length === 0) return;
    let md = `# Omni RAG Chat Export\n*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;
    messages.forEach((m) => {
      md += `### ${m.role === 'user' ? '👤 User' : '🤖 Omni Assistant'}\n\n${m.content}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `omni-chat-${sessionId || 'session'}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Chat exported to Markdown');
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-dark)]">
      {/* Top action bar when messages exist */}
      {messages.length > 0 && (
        <div className="flex items-center justify-end px-6 py-2 border-b border-[var(--border-color)]/40 bg-[var(--bg-dark)]/80 backdrop-blur-xs select-none">
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={handleExportMarkdown}
            title="Export conversation to Markdown"
          >
            <Download size={13} />
            <span>Export Chat</span>
          </button>
        </div>
      )}

      {/* Scrollable Message Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 pb-6 scroll-smooth">
        <div className="max-w-4xl mx-auto w-full">
          {/* Welcome Banner when empty */}
          {messages.length === 0 && (
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
            onStartVoice={onStartVoice}
            showToast={showToast}
          />
        </div>
      </div>
    </div>
  );
};

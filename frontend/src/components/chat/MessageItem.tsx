import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check, RotateCw, Edit3, Volume2, FileText, ChevronDown, ChevronUp, ExternalLink, Sparkles } from 'lucide-react';
import { ChatMessage, ContextChunk } from '../../types/chat';
import { FormatBadge } from '../common/FormatBadge';
import { DocumentSquareTile } from '../common/DocumentSquareTile';
import { OrbitingOrbLoader } from '../common/OrbitingOrbLoader';

interface MessageItemProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  onRetry: (content: string) => void;
  onEdit: (content: string) => void;
  onInspectDoc: (chunk: { filename: string; content?: string; page?: number }) => void;
  onReadAloud: (content: string) => void;
  showToast: (msg: string) => void;
}

interface ParsedCitation {
  id: string;
  filename: string;
  page?: string;
  quote?: string;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isLastAssistant,
  isStreaming,
  onRetry,
  onEdit,
  onInspectDoc,
  onReadAloud,
  showToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const handleCopy = (textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    showToast("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse User Prompt & Referenced Vault Documents
  const { userPrompt, referencedFiles } = useMemo(() => {
    if (message.role !== 'user') return { userPrompt: message.content, referencedFiles: [] };

    const refMatch = message.content.match(/^\[Focus explicitly on referenced Knowledge Vault documents:\s*([^\]]+)\]\s*([\s\S]*)$/i);
    if (refMatch) {
      const files = refMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      return {
        referencedFiles: files,
        userPrompt: refMatch[2].trim() || 'Analyze referenced documents.'
      };
    }

    const legacyMatch = message.content.match(/^\[Referenced Documents:\s*([^\]]+)\]\s*([\s\S]*)$/i);
    if (legacyMatch) {
      const files = legacyMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      return {
        referencedFiles: files,
        userPrompt: legacyMatch[2].trim() || 'Analyze referenced documents.'
      };
    }

    return { userPrompt: message.content, referencedFiles: [] };
  }, [message]);

  // Parse Assistant Response: Extract and Structure "References & Sources"
  const { bodyText, parsedCitations } = useMemo(() => {
    if (message.role !== 'assistant') return { bodyText: message.content, parsedCitations: [] };

    const raw = message.content;
    // Catch any header like "References & Sources", "References:", "### References", etc.
    const refHeaderRegex = /(?:^|\n+)(?:[#*_\s]*)(?:References\s*&\s*Sources|References\s*and\s*Sources|References|Sources|Cited\s*Sources)(?:[#*_\s]*)(?::)?(?:\s*(?:\r?\n)+)/i;
    const match = raw.match(refHeaderRegex);

    if (!match || match.index === undefined) {
      return { bodyText: raw, parsedCitations: [] };
    }

    const body = raw.slice(0, match.index).trim();
    const refsRaw = raw.slice(match.index + match[0].length).trim();

    // Parse citation lines: [2] Resume_final.pdf (Page 1) — "Skills..."
    const lines = refsRaw.split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
    const citations: ParsedCitation[] = [];

    for (const line of lines) {
      // Match pattern: [2] filename.pdf (Page 1) — "quote"
      const citMatch = line.match(/^\[(\d+)\]\s*([^\n(—–:]+?)(?:\s*\((?:Page\s*(\d+)|p\.\s*(\d+))\))?(?:\s*(?:[—–-]|:)\s*["“]?([\s\S]*?)["”]?)?$/i);
      if (citMatch) {
        citations.push({
          id: citMatch[1],
          filename: citMatch[2]?.trim() || 'Document',
          page: citMatch[3] || citMatch[4],
          quote: citMatch[5] ? citMatch[5].replace(/^["“]|["”]$/g, '').trim() : undefined,
        });
      } else if (line.length > 3) {
        // Fallback for unformatted reference line
        citations.push({
          id: String(citations.length + 1),
          filename: 'Cited Document',
          quote: line.replace(/^["“]|["”]$/g, '').trim(),
        });
      }
    }

    return { bodyText: body, parsedCitations: citations };
  }, [message]);

  // 1. USER MESSAGE RENDER (Detached square document preview blocks above bubble)
  if (message.role === 'user') {
    return (
      <div className="w-full flex flex-col items-end my-4 fade-in select-none">
        {/* Detached True Square Document Preview Blocks Above User Query Bubble */}
        {referencedFiles.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-2.5 mb-2">
            {referencedFiles.map(fn => (
              <DocumentSquareTile 
                key={fn}
                filename={fn}
                onClick={() => onInspectDoc?.({ filename: fn })}
              />
            ))}
          </div>
        )}

        {/* Clean User Query Bubble */}
        <div className="max-w-[85%] sm:max-w-[80%] rounded-2xl rounded-tr-sm bg-[var(--bg-user-bubble)] text-[var(--text-main)] border border-[var(--border-color)] text-sm shadow-sm leading-relaxed px-4 py-2.5 select-text">
          <div className="text-[14.5px] leading-relaxed text-[var(--text-main)] font-sans whitespace-pre-wrap break-words">
            {userPrompt}
          </div>
        </div>

        {/* User Prompt Action Icons */}
        <div className="flex items-center gap-1.5 mt-1 px-1 text-[11px] text-[var(--text-muted)]">
          <button 
            className="p-1 rounded-md hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={() => onRetry(userPrompt)}
            title="Retry prompt"
          >
            <RotateCw size={12} />
          </button>
          <button 
            className="p-1 rounded-md hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={() => onEdit(userPrompt)}
            title="Edit prompt"
          >
            <Edit3 size={12} />
          </button>
          <button 
            className="p-1 rounded-md hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={() => handleCopy(userPrompt)}
            title="Copy prompt"
          >
            {copied ? <Check size={12} className="text-[var(--status-active-text)]" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
    );
  }

  // 2. ASSISTANT MESSAGE RENDER
  return (
    <div className="w-full flex flex-col my-5 fade-in">
      {/* Loading Pure Orbiting Orb or Markdown Content Body */}
      {isLastAssistant && isStreaming && !bodyText.trim() ? (
        <div className="py-2.5">
          <OrbitingOrbLoader size="md" />
        </div>
      ) : (
        <div className="omni-prose max-w-none text-sm text-[var(--text-main)] leading-relaxed font-sans">
          <ReactMarkdown
            components={{
              // Interactive Link / Footnote Renderer
              a: ({ href, children }) => (
                <span className="text-[var(--accent-primary)] font-medium cursor-pointer underline hover:text-[var(--accent-hover)] transition-colors">
                  {children}
                </span>
              ),
            }}
          >
            {bodyText}
          </ReactMarkdown>
        </div>
      )}

      {/* COLLAPSIBLE STRUCTURED GROUNDED REFERENCES & SOURCES ACCORDION */}
      {parsedCitations.length > 0 && (
        <div className="mt-4 border border-[var(--border-color)] rounded-2xl bg-[var(--bg-card)] p-3 shadow-xs">
          <div 
            className="flex items-center justify-between cursor-pointer text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] select-none transition-colors"
            onClick={() => setReferencesOpen(!referencesOpen)}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-[var(--accent-primary)]" />
              <span>Grounded References & Sources ({parsedCitations.length} cited)</span>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
              <span className="text-[11px] font-normal font-mono">
                {referencesOpen ? 'Collapse' : 'Expand'}
              </span>
              {referencesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </div>

          {referencesOpen && (
            <div className="mt-3 flex flex-col gap-2 pt-2.5 border-t border-[var(--border-color)]">
              {parsedCitations.map((cit) => (
                <div 
                  key={cit.id}
                  className="p-3 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] shadow-xs hover:border-[var(--accent-primary)]/50 transition-all"
                >
                  {/* Header Row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-5 h-5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                        {cit.id}
                      </span>
                      <FormatBadge filename={cit.filename} size="xs" />
                      <span className="font-medium text-[13px] text-[var(--text-main)] truncate">
                        {cit.filename}
                      </span>
                      {cit.page && (
                        <span className="text-[11px] text-[var(--text-muted)] font-mono flex-shrink-0">
                          · p. {cit.page}
                        </span>
                      )}
                    </div>

                    <button 
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-subtle)] transition-colors cursor-pointer flex-shrink-0"
                      onClick={() => onInspectDoc({ filename: cit.filename, content: cit.quote, page: cit.page ? parseInt(cit.page, 10) : undefined })}
                      title="Inspect document sidecar"
                    >
                      <ExternalLink size={12} />
                      <span>View</span>
                    </button>
                  </div>

                  {/* Grounded Excerpt Quote */}
                  {cit.quote && (
                    <div className="mt-2 pl-3 py-1.5 border-l-2 border-[var(--accent-primary)] text-[12.5px] text-[var(--text-muted)] italic font-serif leading-relaxed bg-[var(--bg-hover)]/30 rounded-r-xl pr-2">
                      &ldquo;{cit.quote}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* RETRIEVED GROUNDING CONTEXT SOURCES ACCORDION */}
      {message.contexts && message.contexts.length > 0 && (
        <div className="mt-3 border border-[var(--border-color)] rounded-2xl bg-[var(--bg-card)] p-3 shadow-xs">
          <div 
            className="flex items-center justify-between cursor-pointer text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] select-none transition-colors"
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-[var(--accent-primary)]" />
              <span>Retrieved Vector Chunks ({message.contexts.length} sources)</span>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
              <span className="text-[11px] font-normal font-mono">
                {sourcesOpen ? 'Collapse' : 'Expand'}
              </span>
              {sourcesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </div>

          {sourcesOpen && (
            <div className="mt-3 flex flex-col gap-2 pt-2.5 border-t border-[var(--border-color)]">
              {message.contexts.map((ctx: ContextChunk, idx: number) => {
                const fname = ctx.filename || ctx.source || 'document';
                return (
                  <div 
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-xs cursor-pointer hover:border-[var(--accent-primary)]/60 transition-all group"
                    onClick={() => onInspectDoc({ filename: fname, content: ctx.parent_content || ctx.content, page: ctx.page })}
                  >
                    <div className="flex items-center gap-2.5 truncate pr-2">
                      <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono flex-shrink-0">
                        {idx + 1}
                      </span>
                      <FormatBadge filename={fname} size="xs" />
                      <span className="font-medium text-[var(--text-main)] truncate text-[12.5px]">{fname}</span>
                      {ctx.page && <span className="text-[var(--text-muted)] font-mono">· p.{ctx.page}</span>}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="px-2 py-0.5 rounded-md bg-[var(--bg-card)] border border-[var(--border-color)] text-[10.5px] text-[var(--text-muted)] font-mono">
                        {ctx.rerank_score ? `score: ${ctx.rerank_score.toFixed(2)}` : 'RRF'}
                      </span>
                      <ExternalLink size={12} className="text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] transition-colors" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Message Actions Bar */}
      <div className="flex items-center gap-2 mt-2 text-[var(--text-muted)] text-xs select-none">
        <button 
          className="px-2 py-1 rounded-lg hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
          onClick={() => handleCopy(message.content)}
          title="Copy Response"
        >
          {copied ? <Check size={12} className="text-[var(--status-active-text)]" /> : <Copy size={12} />}
          <span className="text-[11.5px]">{copied ? 'Copied' : 'Copy'}</span>
        </button>

        <button 
          className="px-2 py-1 rounded-lg hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
          onClick={() => onReadAloud(bodyText || message.content)}
          title="Read Aloud"
        >
          <Volume2 size={12} />
          <span className="text-[11.5px]">Read</span>
        </button>
      </div>
    </div>
  );
};

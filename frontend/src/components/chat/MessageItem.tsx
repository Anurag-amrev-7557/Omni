import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Copy, Check, RotateCw, Edit3, Volume2, FileText, ChevronDown, ChevronUp, ExternalLink, Sparkles, ThumbsUp, ThumbsDown, Globe } from 'lucide-react';
import { ChatMessage, ContextChunk } from '../../types/chat';
import { FormatBadge } from '../common/FormatBadge';
import { DocumentSquareTile } from '../common/DocumentSquareTile';
import { OrbitingOrbLoader } from '../common/OrbitingOrbLoader';
import { api } from '../../services/api';

interface MessageItemProps {
  message: ChatMessage;
  sessionId?: string;
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
  url?: string;
  domain?: string;
  quote?: string;
}

const CodeBlock: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const [copied, setCopied] = useState(false);
  const language = className ? className.replace('language-', '').trim() : '';
  const codeContent = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(codeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-3.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-xs overflow-hidden text-xs font-mono">
      {/* Code Block Header Toolbar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[var(--bg-sidebar)]/80 border-b border-[var(--border-color)]/60 select-none">
        <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-500" />
              <span className="text-emerald-500 font-sans text-[11px]">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span className="font-sans text-[11px]">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Text Content */}
      <div className="p-3.5 overflow-x-auto text-[var(--text-main)] leading-relaxed">
        <code>{children}</code>
      </div>
    </div>
  );
};

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  sessionId,
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
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null);

  const handleCopy = (textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    showToast("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFeedback = async (rating: boolean) => {
    setFeedbackGiven(rating ? 'up' : 'down');
    try {
      await api.submitFeedback({
        session_id: sessionId,
        rating,
        feedback: rating ? 'Helpful answer' : 'Needs improvement'
      });
      showToast(rating ? "Thank you for the positive feedback!" : "Feedback recorded.");
    } catch {
      showToast("Could not record feedback");
    }
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
    const refHeaderRegex = /(?:^|\n+)(?:[#*_\s]*)(?:References\s*&\s*Sources|References\s*and\s*Sources|References|Sources|Cited\s*Sources)(?:[#*_\s]*)(?::)?(?:\s*(?:\r?\n)+)/i;
    const match = raw.match(refHeaderRegex);

    if (!match || match.index === undefined) {
      return { bodyText: raw, parsedCitations: [] };
    }

    const body = raw.slice(0, match.index).replace(/(?:\r?\n\s*[-*_—]{3,}\s*)+$/g, '').trim();
    const refsRaw = raw.slice(match.index + match[0].length).trim();

    const lines = refsRaw.split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
    const citations: ParsedCitation[] = [];

    for (const line of lines) {
      // Check for Markdown web link: [1] [Title](url) (domain) - "quote"
      const webMatch = line.match(/^\[(\d+)\]\s*\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(?:\s*\(([^)]+)\))?(?:\s*(?:[—–-]|:)\s*["“]?([\s\S]*?)["”]?)?$/i);
      if (webMatch) {
        citations.push({
          id: webMatch[1],
          filename: webMatch[2]?.trim() || 'Web Link',
          url: webMatch[3],
          domain: webMatch[4],
          quote: webMatch[5] ? webMatch[5].replace(/^["“]|["”]$/g, '').trim() : undefined,
        });
        continue;
      }

      const citMatch = line.match(/^\[(\d+)\]\s*([^\n(—–:]+?)(?:\s*\((?:Page\s*(\d+)|p\.\s*(\d+))\))?(?:\s*(?:[—–-]|:)\s*["“]?([\s\S]*?)["”]?)?$/i);
      if (citMatch) {
        citations.push({
          id: citMatch[1],
          filename: citMatch[2]?.trim() || 'Document',
          page: citMatch[3] || citMatch[4],
          quote: citMatch[5] ? citMatch[5].replace(/^["“]|["”]$/g, '').trim() : undefined,
        });
      } else if (line.length > 3) {
        citations.push({
          id: String(citations.length + 1),
          filename: 'Cited Source',
          quote: line.replace(/^["“]|["”]$/g, '').trim(),
        });
      }
    }

    return { bodyText: body, parsedCitations: citations };
  }, [message]);

  // Normalize and heal incomplete streaming Markdown syntax
  const formattedBody = useMemo(() => {
    if (!bodyText) return '';
    let s = bodyText;
    // 1. Normalize inline collapsed markdown tables
    s = s.replace(/\|\s*\|\s*([-:]+[-| :]*)\|/g, '|\n| $1 |\n');
    s = s.replace(/\|\s*\|\s*([^|\n]+)/g, '|\n| $1');

    // 2. Stream-Healer: Seal unclosed code fences and tags during active streaming
    if (isStreaming) {
      const codeFenceCount = (s.match(/```/g) || []).length;
      if (codeFenceCount % 2 !== 0) {
        s += '\n```';
      }

      const boldCount = (s.match(/\*\*/g) || []).length;
      if (boldCount % 2 !== 0) {
        s += '**';
      }
    }

    return s;
  }, [bodyText, isStreaming]);

  // 1. USER MESSAGE RENDER
  if (message.role === 'user') {
    return (
      <div className="w-full flex flex-col items-end my-4 fade-in select-none">
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

        <div className="max-w-[85%] sm:max-w-[80%] rounded-2xl rounded-tr-sm bg-[var(--bg-user-bubble)] text-[var(--text-main)] border border-[var(--border-color)] text-sm shadow-sm leading-relaxed px-4 py-2.5 select-text">
          <div className="text-[14.5px] leading-relaxed text-[var(--text-main)] font-sans whitespace-pre-wrap break-words">
            {userPrompt}
          </div>
        </div>

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
      {isLastAssistant && isStreaming && !bodyText.trim() ? (
        <div className="flex items-center gap-3 py-3 fade-in select-none">
          <OrbitingOrbLoader size="sm" />
          <div className="overflow-hidden h-6 flex items-center">
            <span 
              key={message.thought || 'thinking'} 
              className="lottery-text-change text-[13.5px] text-[var(--text-muted)] font-normal inline-block"
            >
              {message.thought || "Synthesizing insights..."}
            </span>
          </div>
        </div>
      ) : (
        <div className="omni-prose max-w-none text-sm text-[var(--text-main)] leading-relaxed font-sans">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              hr: () => <div className="my-5 border-t border-[var(--border-color)]" />,
              a: ({ href, children }) => {
                const childStr = String(children).trim();
                const isCitation = /^\[\d+\]$/.test(childStr);
                if (isCitation) {
                  return (
                    <a 
                      href={href} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center px-1.5 py-0.2 mx-0.5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-medium text-[11px] hover:underline cursor-pointer border border-[var(--accent-primary)]/30 no-underline shadow-2xs leading-tight"
                      title={`Open source citation ${childStr}`}
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <a 
                    href={href} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[var(--accent-primary)] font-medium cursor-pointer underline hover:text-[var(--accent-hover)] transition-colors inline-flex items-center gap-0.5"
                  >
                    {children}
                    <ExternalLink size={10} className="inline opacity-70" />
                  </a>
                );
              },
              table: ({ children }) => (
                <div className="overflow-x-auto my-3.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-xs">
                  <table className="min-w-full divide-y divide-[var(--border-color)] text-xs text-left">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-[var(--bg-sidebar)] text-[var(--text-muted)] font-semibold text-[11.5px] uppercase tracking-wider">
                  {children}
                </thead>
              ),
              th: ({ children }) => (
                <th className="px-3.5 py-2.5 font-semibold text-[var(--text-main)] border-b border-[var(--border-color)] whitespace-nowrap">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-3.5 py-2.5 text-[var(--text-main)] border-b border-[var(--border-color)]/40 leading-relaxed align-top">
                  {children}
                </td>
              ),
              tr: ({ children }) => (
                <tr className="hover:bg-[var(--bg-hover)]/40 transition-colors last:border-b-0">
                  {children}
                </tr>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-5 my-2.5 space-y-1.5 text-[var(--text-main)]">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-5 my-2.5 space-y-1.5 text-[var(--text-main)]">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="leading-relaxed text-[var(--text-main)]">
                  {children}
                </li>
              ),
              h1: ({ children }) => (
                <h1 className="text-xl font-bold text-[var(--text-main)] mt-5 mb-2.5 tracking-tight">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-lg font-bold text-[var(--text-main)] mt-4 mb-2 tracking-tight">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-[15px] font-semibold text-[var(--text-main)] mt-3 mb-1.5">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="my-2 leading-relaxed text-[var(--text-main)]">
                  {children}
                </p>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-[var(--accent-primary)] pl-3.5 py-1.5 my-3 italic text-[var(--text-muted)] bg-[var(--bg-hover)]/30 rounded-r-xl">
                  {children}
                </blockquote>
              ),
              code: ({ children, className }) => {
                const isInline = !className;
                if (isInline) {
                  return (
                    <code className="px-1.5 py-0.5 rounded-md bg-[var(--bg-hover)] text-[var(--accent-primary)] font-mono text-xs border border-[var(--border-color)]/60">
                      {children}
                    </code>
                  );
                }
                return <CodeBlock className={className}>{children}</CodeBlock>;
              }
            }}
          >
            {formattedBody}
          </ReactMarkdown>
        </div>
      )}

      {/* COLLAPSIBLE GROUNDED REFERENCES & SOURCES - Appears as soon as citations are extracted */}
      {parsedCitations.length > 0 && (
        <div className="mt-2.5 border border-[var(--border-color)] rounded-2xl bg-[var(--bg-card)] p-3 shadow-xs fade-in">
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
            <div className="mt-2.5 flex flex-col gap-2 pt-2.5 border-t border-[var(--border-color)]">
              {parsedCitations.map((cit) => (
                <div 
                  key={cit.id}
                  className="p-3 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] shadow-xs hover:border-[var(--accent-primary)]/50 transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-5 h-5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                        {cit.id}
                      </span>
                      {cit.url ? (
                        <Globe size={13} className="text-blue-500 flex-shrink-0" />
                      ) : (
                        <FormatBadge filename={cit.filename} size="xs" />
                      )}
                      <span className="font-medium text-[13px] text-[var(--text-main)] truncate">
                        {cit.filename}
                      </span>
                      {cit.page && (
                        <span className="text-[11px] text-[var(--text-muted)] font-mono flex-shrink-0">
                          · p. {cit.page}
                        </span>
                      )}
                      {cit.domain && (
                        <span className="text-[11px] text-[var(--text-muted)] font-mono flex-shrink-0">
                          · {cit.domain}
                        </span>
                      )}
                    </div>

                    {cit.url ? (
                      <a
                        href={cit.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-blue-500 hover:bg-blue-500/10 transition-colors cursor-pointer flex-shrink-0"
                        title="Open external web source"
                      >
                        <ExternalLink size={12} />
                        <span>Visit</span>
                      </a>
                    ) : (
                      <button 
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-subtle)] transition-colors cursor-pointer flex-shrink-0"
                        onClick={() => onInspectDoc({ filename: cit.filename, content: cit.quote, page: cit.page ? parseInt(cit.page, 10) : undefined })}
                        title="Inspect document sidecar"
                      >
                        <ExternalLink size={12} />
                        <span>View</span>
                      </button>
                    )}
                  </div>

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

      {/* RETRIEVED GROUNDING CONTEXT SOURCES */}
      {!(isLastAssistant && isStreaming) && message.contexts && message.contexts.length > 0 && (
        <div className="mt-2.5 border border-[var(--border-color)] rounded-2xl bg-[var(--bg-card)] p-3 shadow-xs fade-in">
          <div 
            className="flex items-center justify-between cursor-pointer text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] select-none transition-colors"
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-[var(--accent-primary)]" />
              <span>Retrieved Context Sources ({message.contexts.length} items)</span>
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
                const isWeb = ctx.source_type === 'web' || Boolean(ctx.url);

                if (isWeb && ctx.url) {
                  return (
                    <a
                      key={idx}
                      href={ctx.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-xs cursor-pointer hover:border-blue-500/60 transition-all group"
                    >
                      <div className="flex items-center gap-2.5 truncate pr-2">
                        <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold bg-blue-500/10 text-blue-500 font-mono flex-shrink-0">
                          {idx + 1}
                        </span>
                        <Globe size={13} className="text-blue-500 flex-shrink-0" />
                        <span className="font-medium text-[var(--text-main)] truncate text-[12.5px]">{ctx.title || fname}</span>
                        {ctx.domain && <span className="text-[var(--text-muted)] font-mono">· {ctx.domain}</span>}
                      </div>
                      <ExternalLink size={12} className="text-[var(--text-muted)] group-hover:text-blue-500 transition-colors flex-shrink-0" />
                    </a>
                  );
                }

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

      {/* Message Actions Bar with Feedback & Voice - Only visible after response has completely arrived */}
      {!(isLastAssistant && isStreaming) && bodyText.trim().length > 0 && (
        <div className="flex items-center justify-between mt-2 text-[var(--text-muted)] text-xs select-none fade-in">
          <div className="flex items-center gap-2">
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

          {/* RLHF User Feedback Buttons */}
          <div className="flex items-center gap-1">
            <button
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                feedbackGiven === 'up'
                  ? 'bg-green-500/20 text-green-500 font-bold'
                  : 'hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => handleFeedback(true)}
              title="Helpful response"
            >
              <ThumbsUp size={13} />
            </button>
            <button
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                feedbackGiven === 'down'
                  ? 'bg-red-500/20 text-red-500 font-bold'
                  : 'hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => handleFeedback(false)}
              title="Unhelpful response"
            >
              <ThumbsDown size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

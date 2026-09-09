import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  numId: number;
  filename: string;
  page?: string;
  quote?: string;
}

function parseSingleCitation(rawItem: string, fallbackIdx: number): ParsedCitation | null {
  const item = rawItem.trim();
  if (!item || item === '---') return null;

  // 1. Extract Citation ID: e.g. [1], [2], 1., 2.
  let id = '';
  let numId = fallbackIdx;
  const idMatch = item.match(/(?:\[(\d+)\]|^[-*•\s]*(\d+)[\.\)])/);
  if (idMatch) {
    id = idMatch[1] || idMatch[2];
    numId = parseInt(id, 10) || fallbackIdx;
  } else {
    id = String(fallbackIdx);
  }

  // 2. Extract page info: *(Page 1)*, (Page 1), *(p. 1)*, (p. 1), Page 1, p. 1
  let page: string | undefined = undefined;
  const pageMatch = item.match(/(?:\*?\(?\s*(?:Page|p\.)\s*(\d+)\s*\)?\*?)/i);
  if (pageMatch) {
    page = pageMatch[1];
  }

  // 3. Separate quote/excerpt from filename & metadata
  let filename = '';
  let quote = '';

  const dividerRegex = /(?:(?:\*\*\s*|\*\s*|\)\s*|\s)[—–-]\s*|:\s+)(["“*]?[\s\S]+)$/;
  const match = item.match(dividerRegex);

  if (match) {
    quote = match[1];
    let fileMeta = item.slice(0, match.index).trim();
    fileMeta = fileMeta
      .replace(/(?:\*?\(?\s*(?:Page|p\.)\s*\d+\s*\)?\*?)/gi, '')
      .replace(/^[-*•\s\d.\[\]]+/, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\*\*|\*|`|\[|\]/g, '')
      .trim();
    filename = fileMeta;
  } else {
    const quoteMatch = item.match(/(["“][^"”]+["”])/);
    if (quoteMatch) {
      quote = quoteMatch[1];
      let fileMeta = item.slice(0, quoteMatch.index).trim();
      fileMeta = fileMeta
        .replace(/(?:\*?\(?\s*(?:Page|p\.)\s*\d+\s*\)?\*?)/gi, '')
        .replace(/^[-*•\s\d.\[\]]+/, '')
        .replace(/\[\d+\]/g, '')
        .replace(/\*\*|\*|`|\[|\]|—|–|:/g, '')
        .trim();
      filename = fileMeta;
    } else {
      filename = item
        .replace(/(?:\*?\(?\s*(?:Page|p\.)\s*\d+\s*\)?\*?)/gi, '')
        .replace(/^[-*•\s\d.\[\]]+/, '')
        .replace(/\[\d+\]/g, '')
        .replace(/\*\*|\*|`|\[|\]/g, '')
        .trim();
    }
  }

  filename = filename.replace(/^[-*•—–:\s]+/, '').replace(/[-*•—–:\s]+$/, '').trim();
  if (!filename || filename.toLowerCase() === 'document' || filename.toLowerCase() === 'cited document') {
    filename = 'Referenced Document';
  }

  if (quote) {
    quote = quote
      .replace(/^[\s*_"“'—–-]+/, '')
      .replace(/[\s*_"”'—–-]+$/, '')
      .replace(/^["“]([\s\S]*)["”]$/, '$1')
      .replace(/^\*([\s\S]*)\*$/, '$1')
      .replace(/^["“]([\s\S]*)["”]$/, '$1')
      .trim();
  }

  return {
    id,
    numId,
    filename,
    page,
    quote: quote && quote !== filename ? quote : undefined,
  };
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
    const refHeaderRegex = /(?:\r?\n)+(?:\s*---+\s*\r?\n+)?\s*(?:#{1,6}\s*|\*{1,3}\s*)?(?:References\s*&\s*Sources|References\s*and\s*Sources|Grounded\s*References|References|Sources|Cited\s*Sources)(?:\*{1,3})?(?::)?(?:\s*(?:\r?\n)+)/i;
    const match = raw.match(refHeaderRegex);

    if (!match || match.index === undefined) {
      return { bodyText: raw, parsedCitations: [] };
    }

    let body = raw.slice(0, match.index).trim();
    body = body.replace(/(?:\r?\n)*\s*---+\s*$/, '').trim();

    const refsRaw = raw.slice(match.index + match[0].length).trim();
    const rawLines = refsRaw.split(/\r?\n+/).map(l => l.trim()).filter(Boolean);

    const citationBlocks: string[] = [];
    for (const line of rawLines) {
      if (line.match(/^[-*•\d]|^\s*\[\d+\]/)) {
        citationBlocks.push(line);
      } else if (citationBlocks.length > 0) {
        citationBlocks[citationBlocks.length - 1] += ' ' + line;
      } else {
        citationBlocks.push(line);
      }
    }

    const citations: ParsedCitation[] = [];
    citationBlocks.forEach((item, index) => {
      const parsed = parseSingleCitation(item, index + 1);
      if (parsed) {
        citations.push(parsed);
      }
    });

    // Sort numerically by ID
    citations.sort((a, b) => a.numId - b.numId);

    // Deduplicate
    const seen = new Set<string>();
    const deduplicated: ParsedCitation[] = [];
    for (const c of citations) {
      const key = `${c.id}::${c.filename.toLowerCase()}::${c.page || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(c);
      }
    }

    return { bodyText: body, parsedCitations: deduplicated };
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
            className="p-1.5 rounded-lg hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={() => onRetry(userPrompt)}
            title="Retry prompt"
          >
            <RotateCw size={14.5} />
          </button>
          <button 
            className="p-1.5 rounded-lg hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={() => onEdit(userPrompt)}
            title="Edit prompt"
          >
            <Edit3 size={14.5} />
          </button>
          <button 
            className="p-1.5 rounded-lg hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            onClick={() => handleCopy(userPrompt)}
            title="Copy prompt"
          >
            {copied ? <Check size={14.5} className="text-[var(--status-active-text)]" /> : <Copy size={14.5} />}
          </button>
        </div>
      </div>
    );
  }

  // 2. ASSISTANT MESSAGE RENDER
  // If actively streaming and no text has arrived yet, show the orbiting orb loader with live status message
  if (isLastAssistant && isStreaming && !bodyText.trim()) {
    return (
      <div className="w-full flex flex-col my-5 fade-in">
        <div className="py-3 flex items-center gap-3">
          <OrbitingOrbLoader size="md" />
          {message.statusMessage && (
            <span className="text-xs text-[var(--text-muted)] animate-pulse font-sans">
              {message.statusMessage}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col my-5 fade-in">
      {/* Markdown Content Body with full GFM List and Table Formatting */}
      <div className="omni-prose max-w-none text-sm text-[var(--text-main)] leading-relaxed font-sans">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Interactive Link / Footnote Renderer
            a: ({ href, children }) => (
              <span className="text-[var(--accent-primary)] font-medium cursor-pointer underline hover:text-[var(--accent-hover)] transition-colors">
                {children}
              </span>
            ),
            // Responsive Table Styling
            table: ({ children }) => (
              <div className="omni-table-wrapper overflow-x-auto my-3 border border-[var(--border-color)] rounded-xl bg-[var(--bg-card)] shadow-2xs">
                <table className="min-w-full divide-y divide-[var(--border-color)] text-xs text-left">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-[var(--bg-sidebar)] text-[var(--text-muted)] font-semibold uppercase tracking-wider text-[11px]">
                {children}
              </thead>
            ),
            tbody: ({ children }) => (
              <tbody className="divide-y divide-[var(--border-color)]">
                {children}
              </tbody>
            ),
            tr: ({ children }) => (
              <tr className="hover:bg-[var(--bg-hover)] transition-colors">
                {children}
              </tr>
            ),
            th: ({ children }) => (
              <th className="px-3.5 py-2.5 font-semibold text-[var(--text-main)] border-r border-[var(--border-color)] last:border-r-0">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="px-3.5 py-2.5 text-[var(--text-main)] border-r border-[var(--border-color)] last:border-r-0 whitespace-normal">
                {children}
              </td>
            ),
            // Explicit Lists Formatting to counter Tailwind preflight resets
            ul: ({ children }) => (
              <ul className="list-disc pl-5 my-2 space-y-1 text-[var(--text-main)]">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal pl-5 my-2 space-y-1 text-[var(--text-main)]">
                {children}
              </ol>
            ),
            li: ({ children }) => (
              <li className="pl-1 leading-relaxed text-[var(--text-main)]">
                {children}
              </li>
            ),
          }}
        >
          {bodyText}
        </ReactMarkdown>
      </div>

      {/* MINIMALIST GROUNDED REFERENCES & SOURCES */}
      {parsedCitations.length > 0 && (
        <div className="mt-3.5 pt-3 border-t border-[var(--border-color)]">
          <div 
            className="flex items-center justify-between cursor-pointer py-1 select-none group"
            onClick={() => setReferencesOpen(!referencesOpen)}
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center">
                <Sparkles size={12} />
              </div>
              <span className="text-[12px] font-semibold text-[var(--text-main)] tracking-tight">
                Grounded References
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-muted)] font-medium">
                {parsedCitations.length}
              </span>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-main)] font-mono transition-colors">
              <span>{referencesOpen ? 'Collapse' : 'Expand'}</span>
              <ChevronDown 
                size={13} 
                className={`transition-transform duration-300 ease-in-out ${referencesOpen ? 'rotate-180' : 'rotate-0'}`} 
              />
            </div>
          </div>

          <div 
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
              referencesOpen ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
            }`}
          >
            <div className="overflow-hidden">
              <div className="flex flex-col gap-2 pt-0.5">
                {parsedCitations.map((cit) => (
                  <div 
                    key={cit.id}
                    onClick={() => onInspectDoc({
                       filename: cit.filename,
                      content: cit.quote,
                      page: cit.page ? parseInt(cit.page, 10) : undefined
                    })}
                    className="group relative flex flex-col gap-1.5 p-3 rounded-xl bg-[var(--bg-card)]/70 hover:bg-[var(--bg-hover)] border border-[var(--border-color)] hover:border-[var(--border-hover)] transition-all cursor-pointer shadow-2xs"
                  >
                    {/* Top Meta Row */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 truncate">
                        <span className="w-5 h-5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                          {cit.id}
                        </span>
                        <FormatBadge filename={cit.filename} size="xs" />
                        <span className="text-[12.5px] font-medium text-[var(--text-main)] truncate group-hover:text-[var(--accent-primary)] transition-colors">
                          {cit.filename}
                        </span>
                        {cit.page && (
                          <span className="text-[10.5px] font-mono text-[var(--text-muted)] bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-color)] flex-shrink-0">
                            p. {cit.page}
                          </span>
                        )}
                      </div>

                      <button 
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] group-hover:bg-[var(--accent-subtle)] transition-colors cursor-pointer flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectDoc({
                            filename: cit.filename,
                            content: cit.quote,
                            page: cit.page ? parseInt(cit.page, 10) : undefined
                          });
                        }}
                        title="Inspect document"
                      >
                        <span>View</span>
                        <ExternalLink size={11} />
                      </button>
                    </div>

                    {/* Clean Quoted Excerpt */}
                    {cit.quote && (
                      <div className="mt-0.5 pl-2.5 ml-1 border-l-2 border-[var(--accent-primary)]/50 text-[12px] leading-relaxed text-[var(--text-muted)] group-hover:text-[var(--text-main)]/90 transition-colors select-text font-normal">
                        &ldquo;{cit.quote}&rdquo;
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RETRIEVED GROUNDING CONTEXT SOURCES ACCORDION */}
      {message.contexts && message.contexts.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-[var(--border-color)]">
          <div 
            className="flex items-center justify-between cursor-pointer py-1 select-none group"
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)] group-hover:text-[var(--text-main)]">
                <FileText size={12} />
              </div>
              <span className="text-[12px] font-medium text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors">
                Retrieved Vector Chunks
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-muted)] font-medium">
                {message.contexts.length}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-main)] font-mono transition-colors">
              <span>{sourcesOpen ? 'Collapse' : 'Expand'}</span>
              <ChevronDown 
                size={12} 
                className={`transition-transform duration-300 ease-in-out ${sourcesOpen ? 'rotate-180' : 'rotate-0'}`} 
              />
            </div>
          </div>

          <div 
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
              sourcesOpen ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
            }`}
          >
            <div className="overflow-hidden">
              <div className="flex flex-col gap-1.5 pt-0.5">
                {message.contexts.map((ctx: ContextChunk, idx: number) => {
                  const fname = ctx.filename || ctx.source || 'document';
                  return (
                    <div 
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-card)]/50 hover:bg-[var(--bg-hover)] border border-[var(--border-color)] hover:border-[var(--border-hover)] text-xs cursor-pointer transition-all group"
                      onClick={() => onInspectDoc({ filename: fname, content: ctx.parent_content || ctx.content, page: ctx.page })}
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <span className="w-4.5 h-4.5 rounded text-[10px] font-bold bg-[var(--bg-input)] text-[var(--text-muted)] font-mono flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <FormatBadge filename={fname} size="xs" />
                        <span className="font-medium text-[var(--text-main)] truncate text-[12px] group-hover:text-[var(--accent-primary)] transition-colors">
                          {fname}
                        </span>
                        {ctx.page && (
                          <span className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-input)] px-1.5 py-0.5 rounded flex-shrink-0">
                            p. {ctx.page}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[10px] text-[var(--text-muted)] font-mono">
                          {ctx.rerank_score ? `score: ${ctx.rerank_score.toFixed(2)}` : 'RRF'}
                        </span>
                        <ExternalLink size={11} className="text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Message Actions Bar - Render ONLY when the whole response has arrived fully */}
      {(!isStreaming || !isLastAssistant) && bodyText.trim().length > 0 && (
        <div className="flex items-center gap-2 mt-2 text-[var(--text-muted)] text-xs select-none fade-in">
          <button 
            className="px-2.5 py-1.5 rounded-lg hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
            onClick={() => handleCopy(message.content)}
            title="Copy Response"
          >
            {copied ? <Check size={14} className="text-[var(--status-active-text)]" /> : <Copy size={14} />}
            <span className="text-[12px]">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button 
            className="px-2.5 py-1.5 rounded-lg hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
            onClick={() => onReadAloud(bodyText || message.content)}
            title="Read Aloud"
          >
            <Volume2 size={14} />
            <span className="text-[12px]">Read</span>
          </button>
        </div>
      )}
    </div>
  );
};

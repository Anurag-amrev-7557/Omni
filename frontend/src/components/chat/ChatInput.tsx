import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Plus, Mic, ArrowUp, X, ChevronDown, Check, ChevronRight, ChevronLeft, CornerDownLeft, AtSign, Database, FileText, Globe } from 'lucide-react';
import { ModelOption } from '../../types/chat';
import { DocumentItem } from '../../types/document';
import { FormatBadge } from '../common/FormatBadge';
import { DocumentSquareTile } from '../common/DocumentSquareTile';

interface ChatInputProps {
  inputPrompt: string;
  setInputPrompt: (val: string) => void;
  attachedFiles: File[];
  onRemoveAttachedFile: (fileOrIndex: File | number) => void;
  onAttachFiles: (files: FileList | null) => void;
  vaultDocuments?: DocumentItem[];
  referencedVaultDocs?: string[];
  onAddReferencedDoc?: (filename: string) => void;
  onRemoveReferencedDoc?: (filename: string) => void;
  isStreaming: boolean;
  onSend: () => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  effortLevel: string;
  setEffortLevel: (effort: string) => void;
  webSearchEnabled?: boolean;
  onToggleWebSearch?: () => void;
  onStartVoice: () => void;
  showToast: (msg: string) => void;
}

const AVAILABLE_MODELS: ModelOption[] = [
  { name: 'GPT-OSS 120B', desc: 'Flagship high-precision reasoning' },
  { name: 'GPT-OSS 20B', desc: 'Ultra-fast balanced inference' },
  { name: 'Qwen 3.8 27B', desc: 'Advanced enterprise reasoning' },
  { name: 'Qwen 3.6 27B', desc: 'Technical & code synthesis' },
];

export const ChatInput: React.FC<ChatInputProps> = ({
  inputPrompt,
  setInputPrompt,
  attachedFiles,
  onRemoveAttachedFile,
  onAttachFiles,
  vaultDocuments = [],
  referencedVaultDocs = [],
  onAddReferencedDoc,
  onRemoveReferencedDoc,
  isStreaming,
  onSend,
  selectedModel,
  setSelectedModel,
  effortLevel,
  setEffortLevel,
  webSearchEnabled = false,
  onToggleWebSearch,
  onStartVoice,
  showToast,
}) => {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [effortSubmenuOpen, setEffortSubmenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [isPlusClosing, setIsPlusClosing] = useState(false);

  // Attachment Carousel Scroll State
  const carouselRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = carouselRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = carouselRef.current;
    if (el) {
      el.addEventListener('scroll', updateScrollState, { passive: true });
      window.addEventListener('resize', updateScrollState);
      const timer = setTimeout(updateScrollState, 150);
      return () => {
        el.removeEventListener('scroll', updateScrollState);
        window.removeEventListener('resize', updateScrollState);
        clearTimeout(timer);
      };
    }
  }, [referencedVaultDocs, attachedFiles, updateScrollState]);

  const scrollCarousel = (direction: 'left' | 'right') => {
    const el = carouselRef.current;
    if (!el) return;
    const amount = direction === 'left' ? -220 : 220;
    el.scrollBy({ left: amount, behavior: 'smooth' });
  };

  const closePlusMenu = useCallback(() => {
    setIsPlusClosing(true);
    setTimeout(() => {
      setPlusMenuOpen(false);
      setIsPlusClosing(false);
    }, 200);
  }, []);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [isMentionClosing, setIsMentionClosing] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);

  const closeMentionMenu = useCallback(() => {
    setIsMentionClosing(true);
    setTimeout(() => {
      setMentionMenuOpen(false);
      setIsMentionClosing(false);
    }, 200);
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  // Synchronously compute isMultiLine for instant (0ms) height collapse when docs/files are removed
  const isMultiLine = Boolean(
    inputPrompt.includes('\n') || 
    attachedFiles.length > 0 || 
    referencedVaultDocs.length > 0 || 
    (ghostRef.current && ghostRef.current.clientHeight > 30)
  );

  // Filter vault documents based on @ query
  const matchingDocs = useMemo(() => {
    if (!mentionQuery) return vaultDocuments.slice(0, 6);
    return vaultDocuments.filter(d => 
      d.filename.toLowerCase().includes(mentionQuery.toLowerCase())
    ).slice(0, 6);
  }, [vaultDocuments, mentionQuery]);

  // Handle Text Change & @ Trigger
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputPrompt(val);

    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1 && (lastAtIndex === 0 || /\s/.test(textBeforeCursor[lastAtIndex - 1]))) {
      const query = textBeforeCursor.slice(lastAtIndex + 1);
      if (!query.includes(' ') && !query.includes('\n')) {
        setMentionQuery(query);
        setIsMentionClosing(false);
        setMentionMenuOpen(true);
        setMentionIndex(0);
        return;
      }
    }

    if (mentionMenuOpen && !isMentionClosing) {
      closeMentionMenu();
    }
  };

  // Insert Selected Mention
  const handleSelectMentionDoc = useCallback((doc: DocumentItem) => {
    if (!textareaRef.current) return;
    
    const cursorPos = textareaRef.current.selectionStart || 0;
    const textBeforeCursor = inputPrompt.slice(0, cursorPos);
    const textAfterCursor = inputPrompt.slice(cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const newText = textBeforeCursor.slice(0, lastAtIndex) + textAfterCursor;
      setInputPrompt(newText);
    }

    onAddReferencedDoc?.(doc.filename);
    closeMentionMenu();
    showToast(`Referenced @${doc.filename}`);

    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  }, [inputPrompt, onAddReferencedDoc, setInputPrompt, showToast, closeMentionMenu]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Navigate @ mention autocomplete dropdown with arrow keys
    if (mentionMenuOpen && matchingDocs.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(prev => (prev + 1) % matchingDocs.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(prev => (prev - 1 + matchingDocs.length) % matchingDocs.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectMentionDoc(matchingDocs[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMentionMenu();
        return;
      }
    }

    // Normal Send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((inputPrompt.trim() || attachedFiles.length > 0 || referencedVaultDocs.length > 0) && !isStreaming) {
        onSend();
      }
    }
  };

  const hasContent = inputPrompt.trim().length > 0 || attachedFiles.length > 0 || referencedVaultDocs.length > 0;

  return (
    <div className="w-full select-none relative">
      {/* @ MENTION SLIDING WINDOW (Physically emerged from and clipped into the slot behind the input) */}
      {mentionMenuOpen && matchingDocs.length > 0 && (
        <>
          <div 
            className="fixed inset-0 z-0" 
            onClick={closeMentionMenu} 
          />
          <div className="absolute bottom-full mb-2 left-2 sm:left-4 z-10 w-full max-w-[calc(100vw-32px)] sm:max-w-[380px] overflow-hidden pointer-events-none p-0.5">
            <div className={`${isMentionClosing ? 'pure-slide-down' : 'pure-slide-up'} pointer-events-auto w-full max-h-72 overflow-y-auto p-1.5 bg-[var(--bg-modal)]/95 border border-[var(--border-color)] rounded-2xl shadow-[0_20px_48px_rgba(0,0,0,0.28)] select-none backdrop-blur-xl`}>
              {/* Header Label */}
              <div className="flex items-center justify-between px-3 pt-2 pb-1.5 text-[11px] font-medium text-[var(--text-muted)] select-none">
                <span className="flex items-center gap-1.5">
                  <FileText size={13} className="text-[var(--text-muted)]" />
                  <span>Vault documents</span>
                  {mentionQuery && <span className="text-[var(--text-main)] font-normal">&ldquo;{mentionQuery}&rdquo;</span>}
                </span>
                <span className="text-[10.5px] font-mono text-[var(--text-muted)]">Tab / ↵</span>
              </div>

              {/* Document List */}
              <div className="flex flex-col gap-1 mt-0.5">
                {matchingDocs.map((doc, idx) => {
                  const isSelected = mentionIndex === idx;
                  return (
                    <div
                      key={doc.filename}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors duration-100 ${
                        isSelected
                          ? 'bg-[var(--bg-hover)] text-[var(--text-main)] font-medium shadow-xs'
                          : 'hover:bg-[var(--bg-hover)]/60 text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                      onClick={() => handleSelectMentionDoc(doc)}
                      onMouseEnter={() => setMentionIndex(idx)}
                    >
                      <div className="flex items-center gap-3 truncate pr-2">
                        <div className="w-7 h-7 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)] flex-shrink-0">
                          <FileText size={13.5} />
                        </div>
                        <div className="truncate">
                          <div className="font-medium text-[13.5px] text-[var(--text-main)] truncate leading-tight">{doc.filename}</div>
                          <div className="text-[11.5px] text-[var(--text-muted)] font-normal mt-0.5">
                            {doc.pages} {doc.pages === 1 ? 'page' : 'pages'} · {doc.size_mb} MB
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-muted)] flex-shrink-0">
                          ↵
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Morphing Input Card with CSS Grid Auto-Sizing (z-20 sits in front of the sliding tray) */}
      <div 
        className={`relative z-20 rounded-2xl border border-[var(--border-input)] bg-[var(--bg-input)] shadow-lg transition-all duration-200 ease-out focus-within:border-[var(--accent-primary)]/80 focus-within:ring-2 focus-within:ring-[var(--accent-primary)]/25 ${
          isMultiLine ? 'px-4 pt-3 pb-3' : 'px-3.5 py-3 min-h-[52px]'
        }`}
      >
        {/* Hidden File Input */}
        <input 
          type="file" 
          id="chat-file-input" 
          multiple 
          onChange={(e) => onAttachFiles(e.target.files)} 
          className="hidden" 
        />

        {/* REFERENCED VAULT DOCUMENTS & ATTACHED FILES CHIP CAROUSEL */}
        {(referencedVaultDocs.length > 0 || attachedFiles.length > 0) && (
          <div className="relative group/carousel w-full mb-0.5 transition-all duration-200">
            {/* Left Scroll Navigation Button */}
            {canScrollLeft && (
              <button
                type="button"
                onClick={() => scrollCarousel('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-[var(--bg-card)]/95 backdrop-blur-md border border-[var(--border-color)] text-[var(--text-main)] shadow-lg flex items-center justify-center hover:bg-[var(--bg-hover)] hover:scale-105 active:scale-95 transition-all cursor-pointer"
                title="Scroll left"
              >
                <ChevronLeft size={16} />
              </button>
            )}

            {/* In-Place Horizontal Track with Adequate Padding to Avoid Shadow/Button Clipping */}
            <div 
              ref={carouselRef}
              className="flex items-center gap-3.5 overflow-x-auto no-scrollbar scroll-smooth pt-2 pb-3.5 px-2 -mx-1"
            >
              {/* Vault @ Mentions Document Square Blocks */}
              {referencedVaultDocs.map((filename) => (
                <DocumentSquareTile 
                  key={filename}
                  filename={filename}
                  onRemove={() => onRemoveReferencedDoc?.(filename)}
                />
              ))}

              {/* Attached Local Files Document Square Blocks */}
              {attachedFiles.map((file) => (
                <DocumentSquareTile 
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  filename={file.name}
                  fileObject={file}
                  onRemove={() => onRemoveAttachedFile(file)}
                />
              ))}
            </div>

            {/* Right Scroll Navigation Button */}
            {canScrollRight && (
              <button
                type="button"
                onClick={() => scrollCarousel('right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-[var(--bg-card)]/95 backdrop-blur-md border border-[var(--border-color)] text-[var(--text-main)] shadow-lg flex items-center justify-center hover:bg-[var(--bg-hover)] hover:scale-105 active:scale-95 transition-all cursor-pointer"
                title="Scroll right"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        )}

        {/* PLUS ACTION DROPDOWN DOCKED JUST ABOVE LEFT EDGE OF INPUT SECTION */}
        {plusMenuOpen && (
          <>
            <div 
              className="fixed inset-0 z-0" 
              onClick={closePlusMenu} 
            />
            <div className="absolute bottom-full mb-1 left-2 z-10 w-60 overflow-hidden pointer-events-none p-0.5">
              <div className={`${isPlusClosing ? 'pure-slide-down' : 'pure-slide-up'} pointer-events-auto w-full py-1.5 px-1 bg-[var(--bg-modal)] border border-[var(--border-color)] rounded-2xl text-xs select-none`}>
                <label 
                  htmlFor="chat-file-input"
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                  onClick={closePlusMenu}
                >
                  <Plus size={15} className="text-[var(--accent-primary)]" />
                  <span className="font-medium">Upload Local File</span>
                </label>
                <div 
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                  onClick={() => {
                    closePlusMenu();
                    setMentionQuery('');
                    setMentionMenuOpen(true);
                  }}
                >
                  <AtSign size={15} className="text-[var(--accent-primary)]" />
                  <span className="font-medium">Reference Vault File (@)</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* CSS GRID EXPANDING TEXTAREA */}
        <div 
          className={`grid grid-cols-1 items-start w-full transition-all duration-200 ease-out ${
            isMultiLine ? 'pl-0 pr-0' : 'pl-8 pr-16'
          }`}
        >
          {/* Ghost Mirror for continuous zero-jitter growth */}
          <div
            ref={ghostRef}
            aria-hidden="true"
            className="col-start-1 row-start-1 invisible whitespace-pre-wrap break-words min-h-[26px] max-h-[240px] text-[15px] leading-[26px] py-0 m-0 pointer-events-none select-none font-sans"
          >
            {inputPrompt ? inputPrompt + '\n' : 'placeholder'}
          </div>

          {/* Real Input Textarea */}
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={referencedVaultDocs.length > 0 ? "Ask grounded questions about referenced files, or type @ to add more..." : "Write a message (type @ to reference files)..."}
            rows={1}
            disabled={isStreaming}
            className="col-start-1 row-start-1 w-full h-full bg-transparent text-[var(--text-main)] placeholder-[var(--text-muted)] text-[15px] outline-none resize-none min-h-[26px] max-h-[240px] leading-[26px] py-0 m-0 select-text whitespace-pre-wrap break-words block overflow-y-auto font-sans"
          />
        </div>

        {/* SINGLE-LINE MODE ICONS (Pinned inline) */}
        <div 
          className={`transition-opacity duration-200 ${
            isMultiLine ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {/* Plus Icon on Left */}
          <div className="absolute left-3 top-3">
            <button
              className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
              onClick={() => {
                if (plusMenuOpen) {
                  closePlusMenu();
                } else {
                  setIsPlusClosing(false);
                  setPlusMenuOpen(true);
                }
              }}
              title="Add content or reference"
            >
              <Plus size={19} />
            </button>
          </div>

          {/* Voice / Send Controls on Right */}
          <div className="absolute right-3 top-3 flex items-center gap-1">
            <button 
              className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
              onClick={onStartVoice}
              title="Voice Dictation"
            >
              <Mic size={17} />
              <ChevronDown size={12} className="text-[var(--text-muted)]" />
            </button>

            {hasContent && (
              <button 
                className="w-7 h-7 rounded-lg bg-[var(--accent-primary)] text-[var(--accent-contrast-text,#ffffff)] flex items-center justify-center shadow-md hover:bg-[var(--accent-hover)] hover:scale-105 active:scale-95 transition-all cursor-pointer"
                onClick={onSend}
                disabled={isStreaming}
                title="Send"
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>

        {/* MULTI-LINE MODE BOTTOM TOOLBAR */}
        <div 
          className={`flex items-center justify-between transition-all duration-200 ease-out ${
            isMultiLine 
              ? 'opacity-100 max-h-12 pt-2.5 mt-1.5' 
              : 'opacity-0 max-h-0 overflow-hidden pointer-events-none'
          }`}
        >
          {/* Plus Icon on Bottom-Left */}
          <div>
            <button
              className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
              onClick={() => {
                if (plusMenuOpen) {
                  closePlusMenu();
                } else {
                  setIsPlusClosing(false);
                  setPlusMenuOpen(true);
                }
              }}
              title="Add content or reference"
            >
              <Plus size={19} />
            </button>
          </div>

          {/* Right Action Icons on Bottom-Right */}
          <div className="flex items-center gap-1.5">
            <button 
              className="flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
              onClick={onStartVoice}
              title="Voice Dictation"
            >
              <Mic size={17} />
              <ChevronDown size={12} className="text-[var(--text-dark)]" />
            </button>

            <button 
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                hasContent && !isStreaming
                  ? 'bg-[var(--accent-primary)] text-[var(--accent-contrast-text,#ffffff)] shadow-md hover:bg-[var(--accent-hover)] hover:scale-105 active:scale-95 cursor-pointer'
                  : 'text-[var(--text-dark)] hover:text-[var(--text-muted)] cursor-pointer'
              }`}
              onClick={onSend}
              disabled={!hasContent || isStreaming}
              title="Send Message (Enter)"
            >
              {hasContent ? <ArrowUp size={15} /> : <CornerDownLeft size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Footer Disclaimer & Model Selector Row */}
      <div className="flex items-center justify-end sm:justify-between text-xs text-[var(--text-muted)] mt-2.5 px-1">
        {/* Left Disclaimer (Hidden on mobile) */}
        <span className="text-[11.5px] text-[var(--text-muted)] select-none hidden sm:inline">
          Omni is AI and can make mistakes. Please double-check responses.
        </span>

        {/* Right Controls: Web Research & Model Selector */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Live Web Research Toggle */}
          <button
            type="button"
            onClick={onToggleWebSearch}
            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12.5px] transition-all cursor-pointer select-none shadow-2xs ${
              webSearchEnabled
                ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] border border-[var(--accent-primary)]/40 font-medium shadow-[0_0_12px_rgba(224,122,95,0.15)] ring-1 ring-[var(--accent-primary)]/20'
                : 'border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            title={webSearchEnabled ? "Live Web Research enabled" : "Enable Live Web Research & Real-time Intelligence"}
          >
            <Globe 
              size={13.5} 
              className={`transition-transform duration-300 ${
                webSearchEnabled 
                  ? 'text-[var(--accent-primary)] animate-[spin_12s_linear_infinite]' 
                  : 'group-hover:rotate-45'
              }`} 
            />
            <span>Web Search</span>
            {webSearchEnabled && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent-primary)] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent-primary)]"></span>
              </span>
            )}
          </button>

          {/* Model Selector Pill */}
          <div className="relative">
            <button 
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)]/60 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--text-dark)] transition-all cursor-pointer shadow-2xs"
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            >
              <span className="font-medium text-[var(--text-main)]">{selectedModel}</span>
              <span className="text-[var(--text-muted)] text-[11px]">{effortLevel}</span>
            </button>

          {modelDropdownOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setModelDropdownOpen(false)} 
              />
              <div 
                className="dropdown-popover-bottom absolute right-0 bottom-8 z-50 w-72 max-w-[calc(100vw-32px)] py-2 px-1.5 bg-[var(--bg-modal)]/95 border border-[var(--border-color)] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.25)] backdrop-blur-2xl text-xs"
              >
                <div className="px-3 py-1.5 text-[10.5px] font-bold text-[var(--text-dark)] uppercase tracking-wider select-none">
                  Model Selection
                </div>

                <div className="flex flex-col gap-0.5">
                  {AVAILABLE_MODELS.map(m => (
                    <div 
                      key={m.name}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all duration-150 ${
                        selectedModel === m.name
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-medium shadow-sm'
                          : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                      }`}
                      onClick={() => {
                        setSelectedModel(m.name);
                        setModelDropdownOpen(false);
                        showToast(`Model set to ${m.name}`);
                      }}
                    >
                      <div>
                        <div className="font-semibold text-[13px] text-[var(--text-main)]">{m.name}</div>
                        <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{m.desc}</div>
                      </div>
                      {selectedModel === m.name && <Check size={15} className="text-[var(--accent-primary)] flex-shrink-0" />}
                    </div>
                  ))}
                </div>

                <div className="my-2 border-t border-[var(--border-color)]" />

                {/* Effort Level Submenu */}
                <div 
                  className="flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer hover:bg-[var(--bg-hover)] text-[var(--text-main)] transition-colors"
                  onClick={() => setEffortSubmenuOpen(!effortSubmenuOpen)}
                >
                  <span className="font-semibold text-[13px]">Reasoning Effort</span>
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)] font-medium">
                    <span className="px-2 py-0.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[11px]">{effortLevel}</span>
                    <ChevronRight size={13} />
                  </div>
                </div>

                {effortSubmenuOpen && (
                  <div className="bg-[var(--bg-input)]/60 rounded-xl p-1 mt-1 border border-[var(--border-color)]">
                    {['Low', 'Medium', 'High'].map(level => (
                      <div 
                        key={level}
                        className={`flex items-center justify-between px-3 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${
                          effortLevel === level
                            ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-semibold'
                            : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                        }`}
                        onClick={() => {
                          setEffortLevel(level);
                          setEffortSubmenuOpen(false);
                          setModelDropdownOpen(false);
                        }}
                      >
                        <span>{level} reasoning depth</span>
                        {effortLevel === level && <Check size={13} className="text-[var(--accent-primary)]" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  );
};

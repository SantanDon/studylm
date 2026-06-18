import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Citation } from '@/types/message';

interface LiquidCitationProps {
  citation: Citation;
  index: number;
  triggerType?: 'hover' | 'click';
}

const GitHubIcon = () => (
  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482C19.138 20.193 22 16.44 22 12.017 22 6.484 17.522 2 12 2z" />
  </svg>
);

const YouTubeIcon = () => (
  <svg className="w-3.5 h-3.5 text-red-500 fill-current" viewBox="0 0 24 24">
    <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.518 3.545 12 3.545 12 3.545s-7.518 0-9.388.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.87.507 9.388.507 9.388.507s7.518 0 9.388-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const DocumentIcon = () => (
  <svg className="w-3.5 h-3.5 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const NoteIcon = () => (
  <svg className="w-3.5 h-3.5 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.5L15.5 3z" />
    <polyline points="14 3 14 9 20 9" />
  </svg>
);

const LinkIcon = () => (
  <svg className="w-3.5 h-3.5 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const getSourceIcon = (sourceType: string = "") => {
  const type = sourceType.toLowerCase();
  if (type.includes("github") || type.includes("repo")) return <GitHubIcon />;
  if (type.includes("youtube") || type.includes("video")) return <YouTubeIcon />;
  if (type.includes("note")) return <NoteIcon />;
  if (type.includes("web") || type.includes("link") || type.includes("url") || type.includes("http")) return <LinkIcon />;
  return <DocumentIcon />;
};

const LiquidCitation = ({ citation, index, triggerType: _triggerType = 'click' }: LiquidCitationProps) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!citation) {
    return (
      <span className="px-1.5 py-0.5 rounded bg-blue-100/30 text-blue-800/50 text-xs font-medium border border-blue-200/30 select-none">
        [{index}]
      </span>
    );
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const content = (citation.prefetched_content || citation.excerpt || "").trim();
  const lines = content ? content.split('\n') : ["No content available."];
  const startLine = typeof citation.chunk_lines_from === 'number' ? citation.chunk_lines_from : 1;

  return (
    <span className="inline select-none">
      <motion.span
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleToggle}
        className={`cursor-pointer inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border transition-all duration-300 ${
          isOpen
            ? "bg-blue-500/20 text-white border-blue-500/40 shadow-sm"
            : "bg-blue-500/5 text-blue-400/80 border-blue-500/10 hover:bg-blue-500/15 hover:text-blue-300"
        }`}
      >
        [{index}]
      </motion.span>

      <AnimatePresence>
        {isOpen && (
          <motion.span
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 8 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="block w-full border-l-[3px] border-blue-500/80 bg-slate-900/40 dark:bg-black/35 backdrop-blur-sm pl-4 py-2.5 pr-3 my-2 text-xs rounded-r-lg shadow-md border border-slate-800/80 select-text"
          >
            {/* Header */}
            <span className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800/40">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <span className="text-slate-400 flex items-center justify-center">
                  {getSourceIcon(citation.source_type)}
                </span>
                <span className="font-semibold text-slate-200 truncate max-w-[240px]" title={citation.source_title}>
                  {citation.source_title || "Source"}
                </span>
                {typeof citation.chunk_lines_from === 'number' && typeof citation.chunk_lines_to === 'number' && (
                  <span className="text-slate-500">
                    : L{citation.chunk_lines_from}-{citation.chunk_lines_to}
                  </span>
                )}
              </span>
              <span className="text-[9px] uppercase tracking-wider bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded font-semibold">
                {citation.source_type || "DOCUMENT"}
              </span>
            </span>

            {/* Exact Lines Section */}
            <span className="block space-y-1 font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto pr-1">
              {lines.map((lineText, lineIdx) => {
                const currentLineNum = startLine + lineIdx;
                return (
                  <span key={lineIdx} className="flex items-start gap-3 hover:bg-slate-800/20 py-0.5 px-1 rounded transition-colors duration-100">
                    <span className="text-slate-600 dark:text-slate-500 font-mono text-[10px] select-none text-right min-w-[28px] border-r border-slate-800/50 pr-2">
                      {currentLineNum}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all text-slate-200 dark:text-slate-100">
                      {lineText}
                    </span>
                  </span>
                );
              })}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};

export default LiquidCitation;

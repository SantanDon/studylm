import React, { useState, useCallback } from 'react';
import { MessageSegment, Citation } from '@/types/message';
import { extractCitations } from '@/lib/citations/citationManager';
import { processMarkdownWithCitations } from './markdownParser';
import { motion, AnimatePresence } from 'framer-motion';

interface MarkdownRendererProps {
  content: string | { segments: MessageSegment[]; citations: Citation[] };
  className?: string;
  onCitationClick?: (citation: Citation) => void;
  isUserMessage?: boolean;
}

const FragmentComponent = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="my-3 rounded-xl border border-white/10 bg-white/5 overflow-hidden ring-1 ring-white/5 shadow-inner">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-white/5 hover:bg-white/10 transition-colors duration-200 text-left"
      >
        <span className="text-[10px] font-mono text-blue-400 uppercase tracking-widest">{title}</span>
        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} className="text-gray-500">▼</motion.span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 py-3 text-sm text-gray-400 leading-relaxed border-t border-white/5"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const MarkdownRenderer = ({ content, className = '', onCitationClick, isUserMessage = false }: MarkdownRendererProps) => {
  const [hoveredCitation, setHoveredCitation] = useState<number | null>(null);

  const handleCitationHover = useCallback((index: number | null) => {
    setHoveredCitation(index);
  }, []);

  const renderContent = (segments: MessageSegment[], citations: Citation[]) => {
    return segments.map((segment, idx) => {
      if (segment.type === 'fragment') {
        const match = segment.text.match(/\[FRAGMENT:\s*(.*?)\]([\s\S]*)/);
        if (match) {
          return <FragmentComponent key={idx} title={match[1]}>{match[2]}</FragmentComponent>;
        }
      }
      
      return (
        <React.Fragment key={idx}>
          {processMarkdownWithCitations(
            [segment], 
            citations, 
            onCitationClick, 
            isUserMessage,
            hoveredCitation,
            handleCitationHover
          )}
        </React.Fragment>
      );
    });
  };

  if (typeof content === 'object' && 'segments' in content) {
    return (
      <div className={className}>
        {renderContent(content.segments, content.citations)}
      </div>
    );
  }

  const textContent = typeof content === 'string' ? content : '';
  const parsedCitations = extractCitations(textContent);
  
  const segments: MessageSegment[] = [{ text: textContent }];
  const citations: Citation[] = parsedCitations;
  
  return (
    <div className={className}>
      {renderContent(segments, citations)}
    </div>
  );
};

export default React.memo(MarkdownRenderer, (prevProps, nextProps) => {
  // If it's a string, we only care if the string itself changed
  if (typeof prevProps.content === 'string' && typeof nextProps.content === 'string') {
    return prevProps.content === nextProps.content;
  }
  
  // If it's an object, we want to allow standard React updates but avoid deep-thrashing
  // if the segment references haven't shifted out from under us.
  return prevProps.content === nextProps.content && prevProps.isUserMessage === nextProps.isUserMessage;
});

import React from 'react';
import CitationButton from './CitationButton';
import LiquidCitation from './LiquidCitation';
import { Citation, MessageSegment } from '@/types/message';

const CITATION_MARKER_PATTERN = /\[(\d+)\]/g;

export const processInlineMarkdown = (text: string) => {
  const parts = text.split(/(\*\*.*?\*\*|__.*?__)/g);
  
  return parts.map((part, partIndex) => {
    if (part.match(/^\*\*(.*)\*\*$/)) {
      const boldText = part.replace(/^\*\*(.*)\*\*$/, '$1');
      return <strong key={partIndex}>{boldText}</strong>;
    } else if (part.match(/^__(.*__)$/)) {
      const boldText = part.replace(/^__(.*__)$/, '$1');
      return <strong key={partIndex}>{boldText}</strong>;
    } else {
      // Replace line breaks with spaces for inline rendering
      return part.replace(/\n/g, ' ');
    }
  });
};

export const processTextWithMarkdown = (text: string) => {
  const lines = text.split('\n');
  
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*.*?\*\*|__.*?__)/g);
    
    const processedLine = parts.map((part, partIndex) => {
      if (part.match(/^\*\*(.*)\*\*$/)) {
        const boldText = part.replace(/^\*\*(.*)\*\*$/, '$1');
        return <strong key={partIndex}>{boldText}</strong>;
      } else if (part.match(/^__(.*__)$/)) {
        const boldText = part.replace(/^__(.*__)$/, '$1');
        return <strong key={partIndex}>{boldText}</strong>;
      } else {
        return part;
      }
    });

    return (
      <span key={lineIndex}>
        {processedLine}
        {lineIndex < lines.length - 1 && <br />}
      </span>
    );
  });
};

export const processTextWithMarkdownAndCitations = (
  text: string,
  citations: Citation[],
  _onCitationClick?: (citation: Citation) => void,
  _hoveredCitation?: number | null,
  _onHover?: (index: number | null) => void
): (string | JSX.Element)[] => {
  const lines = text.split('\n');
  
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*.*?\*\*|__.*?__|(?:\[\d+\]))/g);
    
    const processedLine = parts.map((part, partIndex) => {
      if (part.match(/^\*\*(.*)\*\*$/)) {
        const boldText = part.replace(/^\*\*(.*)\*\*$/, '$1');
        return <strong key={`${lineIndex}-${partIndex}`}>{boldText}</strong>;
      } else if (part.match(/^__(.*__)$/)) {
        const boldText = part.replace(/^__(.*__)$/, '$1');
        return <strong key={`${lineIndex}-${partIndex}`}>{boldText}</strong>;
      } else if (part.match(/^\[\d+\]$/)) {
        const citationIndex = parseInt(part.replace(/\[(\d+)\]/, '$1'), 10);
        const citation = citations.find(
          c => c.citation_id === citationIndex || c.chunk_index === citationIndex - 1
        );
        
        return (
          <LiquidCitation
            key={`${lineIndex}-${partIndex}-citation`}
            index={citationIndex}
            citation={citation!}
            triggerType="hover"
          />
        );
      } else {
        return part;
      }
    });

    return (
      <span key={lineIndex}>
        {processedLine}
        {lineIndex < lines.length - 1 && <br />}
      </span>
    );
  });
};

export const processMarkdownWithCitations = (
  segments: MessageSegment[], 
  citations: Citation[], 
  onCitationClick?: (citation: Citation) => void,
  isUserMessage: boolean = false,
  hoveredCitation?: number | null,
  onHover?: (index: number | null) => void
) => {
  if (isUserMessage) {
    return (
      <span>
        {segments.map((segment, index) => (
          <span key={index}>
            {processInlineMarkdown(segment.text)}
            {segment.citation_id && onCitationClick && (
              <CitationButton
                chunkIndex={(() => {
                  const citation = citations.find(c => c.citation_id === segment.citation_id);
                  return citation?.chunk_index || 0;
                })()}
                onClick={() => {
                  const citation = citations.find(c => c.citation_id === segment.citation_id);
                  if (citation) {
                    onCitationClick(citation);
                  }
                }}
              />
            )}
          </span>
        ))}
      </span>
    );
  }

  const elements: JSX.Element[] = [];
  
  segments.forEach((segment, segmentIndex) => {
    const citation = segment.citation_id ? citations.find(c => c.citation_id === segment.citation_id) : undefined;
    
    // Update: insert line breaks before heading markers OR list markers that appear mid-text
    let preprocessed = segment.text;
    // Insert \n before headers or lists that follow sentence-ending punctuation or text
    preprocessed = preprocessed.replace(/([.!?:;])\s*(#{1,3}\s|[-*]\s)/g, '$1\n$2');
    // Also handle markers that follow a closing bold/italic marker
    preprocessed = preprocessed.replace(/([*_]{1,2})\s*(#{1,3}\s|[-*]\s)/g, '$1\n$2');
    
    // Split into blocks but keep single-newline lists/headers together as potential groups
    const blocks = preprocessed.split(/\n\s*\n/).filter((text: string) => text.trim());

    blocks.forEach((block: string, blockIndex: number) => {
      const lines = block.split('\n');
      let i = 0;
      
      while (i < lines.length) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (line === '') {
          i++;
          continue;
        }

        const isLastLine = blockIndex === blocks.length - 1 && i === lines.length - 1;

        // Check for headings
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const headingContentText = headingMatch[2];
          const processedContent = processTextWithMarkdownAndCitations(
            headingContentText,
            citations,
            onCitationClick,
            hoveredCitation,
            onHover
          );
          
          if (level === 1) {
            elements.push(
              <div key={`${segmentIndex}-${blockIndex}-${i}`} className="w-full mt-6 mb-4 px-4 py-3 bg-blue-500/5 dark:bg-blue-500/10 border-l-4 border-blue-500 rounded-r-xl ring-1 ring-black/5 shadow-sm">
                <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 tracking-wide uppercase text-[12px] text-blue-500 dark:text-blue-400">
                  {processedContent}
                  {isLastLine && citation && onCitationClick && (
                    <CitationButton
                      chunkIndex={citation.chunk_index || 0}
                      onClick={() => onCitationClick(citation)}
                    />
                  )}
                </h1>
              </div>
            );
          } else if (level === 2) {
            elements.push(
              <div key={`${segmentIndex}-${blockIndex}-${i}`} className="w-full mt-5 mb-3">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 pl-3 border-l-2 border-indigo-500/50 py-0.5 tracking-wide">
                  {processedContent}
                  {isLastLine && citation && onCitationClick && (
                    <CitationButton
                      chunkIndex={citation.chunk_index || 0}
                      onClick={() => onCitationClick(citation)}
                    />
                  )}
                </h2>
              </div>
            );
          } else {
            const Tag = `h${level}` as keyof JSX.IntrinsicElements;
            const hClass = level === 3 
              ? "text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-2 tracking-wide"
              : "text-xs font-semibold text-slate-600 dark:text-slate-200 mt-3 mb-1.5 uppercase tracking-wider";
            elements.push(
              <Tag key={`${segmentIndex}-${blockIndex}-${i}`} className={hClass}>
                {processedContent}
                {isLastLine && citation && onCitationClick && (
                  <CitationButton
                    chunkIndex={citation.chunk_index || 0}
                    onClick={() => onCitationClick(citation)}
                  />
                )}
              </Tag>
            );
          }
          i++;
          continue;
        }

        // Check for list items (bullet and numbered)
        const bulletMatch = line.match(/^[-*]\s+(.*)$/);
        const numberMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (bulletMatch || numberMatch) {
          const listItems: JSX.Element[] = [];
          const isNumbered = !!numberMatch;
          
          while (i < lines.length) {
            const currentLine = lines[i].trim();
            const currBullet = currentLine.match(/^[-*]\s+(.*)$/);
            const currNumber = currentLine.match(/^(\d+)\.\s+(.*)$/);
            
            if (!currBullet && !currNumber) {
              break;
            }
            
            const itemText = currBullet ? currBullet[1] : currNumber![2];
            const processedItemContent = processTextWithMarkdownAndCitations(
              itemText,
              citations,
              onCitationClick,
              hoveredCitation,
              onHover
            );
            
            const isItemLastLine = blockIndex === blocks.length - 1 && i === lines.length - 1;
            
            listItems.push(
              <li key={`li-${segmentIndex}-${blockIndex}-${i}`} className="mb-1.5 text-slate-700 dark:text-slate-100 leading-relaxed text-sm">
                {processedItemContent}
                {isItemLastLine && citation && onCitationClick && (
                  <CitationButton
                    chunkIndex={citation.chunk_index || 0}
                    onClick={() => onCitationClick(citation)}
                  />
                )}
              </li>
            );
            i++;
          }
          
          const ListTag = isNumbered ? 'ol' : 'ul';
          const listClass = isNumbered ? 'list-decimal my-3 pl-6 space-y-1.5' : 'list-disc my-3 pl-6 space-y-1.5';
          
          elements.push(
            <ListTag key={`list-${segmentIndex}-${blockIndex}-${i}`} className={listClass}>
              {listItems}
            </ListTag>
          );
          continue;
        }

        // Regular paragraph
        if (line.length > 0) {
          const processedContent = processTextWithMarkdownAndCitations(
            line,
            citations,
            onCitationClick,
            hoveredCitation,
            onHover
          );
          
          elements.push(
            <p key={`${segmentIndex}-${blockIndex}-${i}`} className="mb-2.5 leading-relaxed text-slate-700 dark:text-slate-100 text-sm">
              {processedContent}
              {isLastLine && citation && onCitationClick && (
                <CitationButton
                  chunkIndex={citation.chunk_index || 0}
                  onClick={() => onCitationClick(citation)}
                />
              )}
            </p>
          );
        }
        
        i++;
      }
    });
  });
  
  return elements;
};

export const renderTextWithCitationMarkers = (
  text: string,
  citations: Citation[],
  _onCitationClick?: (citation: Citation) => void,
  _hoveredCitation?: number | null,
  _onHover?: (index: number | null) => void
): React.ReactNode => {
  const parts: (string | React.ReactNode)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  
  const regex = new RegExp(CITATION_MARKER_PATTERN.source, 'g');
  
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    
    const citationIndex = parseInt(match[1], 10);
    const citation = citations.find(
      c => c.citation_id === citationIndex || c.chunk_index === citationIndex - 1
    );
    
    parts.push(
      <LiquidCitation
        key={`citation-${match.index}`}
        index={citationIndex}
        citation={citation!}
        triggerType="hover"
      />
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  return <>{parts}</>;
};

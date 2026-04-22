import React from 'react';
import CitationButton from './CitationButton';
import LiquidCitation from './LiquidCitation';

const CITATION_MARKER_PATTERN = /\[(\d+)\]/g;
const FRAGMENT_PATTERN = /\[FRAGMENT:\s*(.*?)\]([\s\S]*?)(?=\[FRAGMENT:|$)/g;

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
  onCitationClick?: (citation: Citation) => void,
  hoveredCitation?: number | null,
  onHover?: (index: number | null) => void
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
    const blocks = preprocessed.split(/\n\s*\n/).filter(text => text.trim());
    
    blocks.forEach((block, blockIndex) => {
      const lines = block.split('\n');
      let i = 0;
      
      while (i < lines.length) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (line === '') {
          i++;
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
          
          const isLastLine = blockIndex === blocks.length - 1 && i === lines.length - 1;
          
          elements.push(
            <p key={`${segmentIndex}-${blockIndex}-${i}`} className="mb-1.5 leading-relaxed text-gray-800">
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
  onCitationClick?: (citation: Citation) => void,
  hoveredCitation?: number | null,
  onHover?: (index: number | null) => void
): JSX.Element => {
  const parts: (string | JSX.Element)[] = [];
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

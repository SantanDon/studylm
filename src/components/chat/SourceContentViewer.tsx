
import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Citation } from '@/types/message';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface SourceContentViewerProps {
  citation: Citation | null;
  sourceContent?: string;
  sourceSummary?: string;
  sourceUrl?: string;
  sourceMetadata?: {
    transcriptProvider?: string;
    transcriptMode?: string;
    transcriptLanguage?: string | null;
    timestampedTranscript?: boolean;
    timingQuality?: 'provider' | 'mixed' | 'inferred' | 'none';
    transcriptQuality?: { tier?: string; score?: number; warnings?: string[] };
    providerCapabilities?: { seekableCitations?: boolean; timestampedSegments?: boolean };
    transcriptSegments?: Array<{ text: string; offset: number; duration: number; lang?: string | null; timingSource?: 'provider' | 'inferred' }>;
  };
  className?: string;
  isOpenedFromSourceList?: boolean;
}

const SourceContentViewer = ({ 
  citation, 
  sourceContent, 
  sourceSummary,
  sourceUrl,
  sourceMetadata,
  className = '',
  isOpenedFromSourceList = false
}: SourceContentViewerProps) => {
  const highlightedContentRef = useRef<HTMLDivElement>(null);
  const scrollAreaViewportRef = useRef<HTMLDivElement>(null);
  
  // Control accordion state based on how the viewer was opened
  const [accordionValue, setAccordionValue] = useState<string>(
    isOpenedFromSourceList ? "guide" : ""
  );

  // Check if we have valid citation line data (indicating a real citation click)
  const hasValidCitationLines = citation && 
    typeof citation.chunk_lines_from === 'number' && 
    typeof citation.chunk_lines_to === 'number' &&
    citation.chunk_lines_from > 0;

  console.log('SourceContentViewer: Render with citation', {
    citationId: citation?.citation_id,
    sourceId: citation?.source_id,
    hasValidCitationLines,
    isOpenedFromSourceList,
    chunkLinesFrom: citation?.chunk_lines_from,
    chunkLinesTo: citation?.chunk_lines_to
  });

  // Auto-scroll to highlighted content when citation changes and has valid line data
  useEffect(() => {
    console.log('SourceContentViewer: Auto-scroll effect triggered', {
      hasValidCitationLines,
      citationId: citation?.citation_id,
      hasHighlightedRef: !!highlightedContentRef.current,
      hasScrollAreaRef: !!scrollAreaViewportRef.current
    });

    if (hasValidCitationLines && highlightedContentRef.current && scrollAreaViewportRef.current) {
      console.log('SourceContentViewer: Starting auto-scroll process');
      
      // Increased delay to ensure DOM has fully updated
      const timer = setTimeout(() => {
        if (highlightedContentRef.current && scrollAreaViewportRef.current) {
          console.log('SourceContentViewer: Executing auto-scroll');
          
          // Find the actual viewport element within the ScrollArea
          const scrollAreaElement = scrollAreaViewportRef.current;
          const viewport = scrollAreaElement.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
          
          if (viewport && highlightedContentRef.current) {
            const highlightedElement = highlightedContentRef.current;
            
            console.log('SourceContentViewer: Scroll calculation', {
              highlightedOffsetTop: highlightedElement.offsetTop,
              highlightedHeight: highlightedElement.clientHeight,
              viewportHeight: viewport.clientHeight,
              currentScrollTop: viewport.scrollTop
            });
            
            // Calculate the scroll position to center the highlighted content
            const scrollTop = highlightedElement.offsetTop - (viewport.clientHeight / 2) + (highlightedElement.clientHeight / 2);
            const targetScrollTop = Math.max(0, scrollTop);
            
            console.log('SourceContentViewer: Scrolling to position', { targetScrollTop });
            
            viewport.scrollTo({
              top: targetScrollTop,
              behavior: 'smooth'
            });
          } else {
            console.log('SourceContentViewer: Viewport or highlighted element not found', {
              viewport: !!viewport,
              highlightedElement: !!highlightedContentRef.current
            });
          }
        }
      }, 300); // Increased delay for better reliability

      return () => clearTimeout(timer);
    }
  }, [citation?.citation_id, citation?.chunk_lines_from, citation?.chunk_lines_to, citation?.source_id, hasValidCitationLines]);

  // Close guide when a real citation is clicked (has valid line data)
  useEffect(() => {
    if (hasValidCitationLines) {
      console.log('SourceContentViewer: Closing guide for real citation');
      setAccordionValue("");
    }
  }, [hasValidCitationLines]);

  if (!citation || !sourceContent) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p className="text-sm">Select a citation to view source content</p>
      </div>
    );
  }

  const getSourceIcon = (type: string) => {
    if (type === 'youtube' || type === 'video') {
      return (
        <svg className="w-full h-full text-red-500 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M23.498 6.163c-.272-.98-1.09-1.755-2.115-2.021C19.516 3.6 12 3.6 12 3.6s-7.516 0-9.383.542C1.59 4.408.773 5.184.5 6.163.003 7.984 0 12 0 12s.003 4.015.5 5.837c.272.98 1.09 1.755 2.115 2.021C4.484 20.4 12 20.4 12 20.4s7.516 0 9.383-.542c1.025-.266 1.843-1.042 2.115-2.021.497-1.822.5-5.837.5-5.837s-.003-4.015-.5-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
      );
    }

    const iconMap: Record<string, string> = {
      'pdf': '/file-types/PDF.svg',
      'text': '/file-types/TXT.png',
      'website': '/file-types/WEB.svg',
      'youtube': '/file-types/MP3.png',
      'audio': '/file-types/MP3.png',
      'doc': '/file-types/DOC.png',
      'multiple-websites': '/file-types/WEB.svg',
      'copied-text': '/file-types/TXT.png'
    };

    const iconUrl = iconMap[type] || iconMap['text']; // fallback to TXT icon
    
    return (
      <img 
        src={iconUrl} 
        alt={`${type} icon`} 
        className="w-full h-full object-contain"
        onError={(e) => {
          // Fallback to a simple text indicator if image fails to load
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          target.parentElement!.innerHTML = '📄';
        }}
      />
    );
  };


  const timestampSegments = sourceMetadata?.transcriptSegments || [];
  const formatMoment = (offsetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(offsetMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  };
  const youtubeMomentUrl = (offsetMs: number) => {
    if (!sourceUrl) return undefined;
    try {
      const url = new URL(sourceUrl);
      url.searchParams.set('t', `${Math.max(0, Math.floor(offsetMs / 1000))}s`);
      return url.toString();
    } catch {
      const separator = sourceUrl.includes('?') ? '&' : '?';
      return `${sourceUrl}${separator}t=${Math.max(0, Math.floor(offsetMs / 1000))}s`;
    }
  };

  // Split content into lines for highlighting
  const lines = sourceContent.split('\n');
  
  // Determine the highlight range based on whether we have valid citation line data
  let startLine: number;
  let endLine: number;
  
  if (hasValidCitationLines) {
    // For real citations with valid line data, highlight the specific lines
    startLine = citation.chunk_lines_from!;
    endLine = citation.chunk_lines_to!;
    console.log('SourceContentViewer: Will highlight lines', { startLine, endLine });
  } else {
    // For source list clicks or citations without line data, don't highlight
    startLine = -1;
    endLine = -1;
    console.log('SourceContentViewer: No highlighting (no valid line data)');
  }

  const renderHighlightedContent = () => {
    return lines.map((line, index) => {
      const lineNumber = index + 1;
      const isHighlighted = startLine > 0 && lineNumber >= startLine && lineNumber <= endLine;
      const isFirstHighlightedLine = isHighlighted && lineNumber === startLine;
      
      return (
        <div
          key={index}
          ref={isFirstHighlightedLine ? highlightedContentRef : null}
          className={`py-2 px-3 rounded leading-relaxed ${
            isHighlighted 
              ? 'border-l-4' 
              : 'hover:bg-gray-50'
          }`}
          style={isHighlighted ? { 
            backgroundColor: '#eadef9', 
            borderLeftColor: '#9333ea' 
          } : {}}
        >
          <span className={isHighlighted ? 'font-medium' : ''}>{line}</span>
        </div>
      );
    });
  };

  return (
    <div
      className={`flex flex-col h-full overflow-hidden ${className}`}
      data-testid="source-content-viewer"
      aria-label={`${citation.source_title} source content`}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center space-x-2 mb-2">
          <div className="w-6 h-6 bg-white rounded border border-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {getSourceIcon(citation.source_type)}
          </div>
          <span className="font-medium text-gray-900 truncate">{citation.source_title}</span>
          {citation.seek_url && (
            <a
              href={citation.seek_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
            >
              Watch at {citation.timestamp_label || 'cited moment'}
            </a>
          )}
        </div>
      </div>


      {citation.source_type === 'youtube' && sourceMetadata?.providerCapabilities?.seekableCitations && timestampSegments.length > 0 && (
        <div className="border-b border-gray-200 bg-red-50/60 px-4 py-3 dark:border-border dark:bg-red-950/10" data-testid="youtube-transcript-timeline">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-gray-900 dark:text-foreground">Timestamped transcript</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                {sourceMetadata?.transcriptProvider || 'StudyPod'} - {timestampSegments.length} segments
              </p>
            </div>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {timestampSegments.slice(0, 250).map((segment, index) => {
              const href = youtubeMomentUrl(segment.offset);
              return (
                <a
                  key={`${segment.offset}-${index}`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-red-200 hover:bg-white dark:hover:border-red-900/50 dark:hover:bg-background"
                >
                  <span className="w-12 flex-shrink-0 font-mono text-red-600 dark:text-red-400">{formatMoment(segment.offset)}</span>
                  <span className="line-clamp-2 text-gray-700 dark:text-gray-300">{segment.text}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Source Guide Accordion */}
      {sourceSummary && (
        <div className="border-b border-gray-200 flex-shrink-0">
          <Accordion type="single" value={accordionValue} onValueChange={setAccordionValue} collapsible>
            <AccordionItem value="guide" className="border-0">
              <AccordionTrigger 
                className="px-4 py-3 text-sm font-medium hover:no-underline hover:bg-blue-50" 
                style={{ color: '#234776' }}
                chevronColor="#234776"
              >
                <div className="flex items-center space-x-2">
                  <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#234776">
                    <path d="M166.67-120.67 120-167.33l317.67-318L254-531l194-121-16.33-228 175 147L818-818.33l-85.67 211.66L880-432l-228.67-16.67-120.66 194L485-438.33 166.67-120.67Zm24.66-536L120-728l72-72 71.33 71.33-72 72Zm366.34 233 58-94.33 111 8.33-72-85 41.66-102.66-102.66 41.66-85-71.66L517-616.67l-94.33 59 108 26.67 27 107.33Zm171 303.67-71.34-72 71.34-71.33 71.33 72L728.67-120ZM575-576Z"/>
                  </svg>
                  <span>Source guide</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="text-sm text-gray-700 space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Summary</h4>
                    <p className="leading-relaxed">{sourceSummary}</p>
                  </div>
                  
                  {/* Show URL for website sources */}
                  {citation.source_type === 'website' && sourceUrl && (
                    <div>
                      <h4 className="font-medium mb-2">URL</h4>
                      <a 
                        href={sourceUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline break-all text-sm"
                      >
                        {sourceUrl}
                      </a>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1 h-full" ref={scrollAreaViewportRef}>
        <div className="p-4">
          <div className="prose prose-gray max-w-none space-y-1">
            {renderHighlightedContent()}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default SourceContentViewer;

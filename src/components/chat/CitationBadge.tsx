import React, { useState } from 'react';
import { Citation } from '@/types/message';

interface CitationBadgeProps {
  index: number;
  citation?: Citation;
  isHovered?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export const CitationBadge = ({
  index,
  citation,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: CitationBadgeProps) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <span className="relative inline-flex items-baseline px-0.5">
      <button
        className={`
          flex items-center justify-center
          w-4 h-4 text-[10px] font-bold rounded-full
          transition-all duration-200 cursor-pointer
          transform translate-y-[-0.3rem]
          ${isHovered 
            ? 'bg-blue-600 text-white shadow-sm scale-110' 
            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200'
          }
        `}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onMouseEnter={() => {
          setShowTooltip(true);
          onMouseEnter();
        }}
        onMouseLeave={() => {
          setShowTooltip(false);
          onMouseLeave();
        }}
        aria-label={citation ? `Citation ${index}: ${citation.source_title}` : `Citation ${index}`}
      >
        {index}
      </button>
      
      {showTooltip && citation && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 pointer-events-none">
          <div className="bg-gray-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 whitespace-nowrap max-w-xs">
            <div className="font-medium truncate">{citation.source_title}</div>
            {citation.chunk_lines_from && citation.chunk_lines_to && (
              <div className="text-gray-300 mt-0.5">
                Lines {citation.chunk_lines_from}-{citation.chunk_lines_to}
              </div>
            )}
            <div
              className="absolute left-1/2 transform -translate-x-1/2 top-full"
              style={{
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '5px solid #111827',
              }}
            />
          </div>
        </div>
      )}
    </span>
  );
};

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Citation } from '@/types/message';

interface LiquidCitationProps {
  citation: Citation;
  index: number;
  triggerType: 'hover' | 'click';
}

const LiquidCitation = ({ citation, index, triggerType }: LiquidCitationProps) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!citation) {
    return (
      <span className="px-1.5 py-0.5 rounded bg-blue-100/30 text-blue-800/50 text-xs font-medium border border-blue-200/30">
        [{index}]
      </span>
    );
  }

  const handleInteraction = (state: boolean) => {
    if (triggerType === 'hover') {
      setIsOpen(state);
    }
  };

  const handleToggle = () => {
    if (triggerType === 'click') {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => handleInteraction(true)}
      onMouseLeave={() => handleInteraction(false)}
      onClick={handleToggle}
    >
      <motion.span
        whileHover={{ scale: 1.05 }}
        className="cursor-pointer px-1.5 py-0.5 rounded bg-blue-100/30 text-blue-800 text-xs font-medium border border-blue-200/50 hover:bg-blue-200/50 transition-colors duration-200"
      >
        [{index}]
      </motion.span>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 max-h-96 overflow-y-auto"
          >
            <div className="p-4 rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden sovereign-glass">
              {/* Scanline Effect */}
              <div className="absolute inset-0 pointer-events-none opacity-5 bg-gradient-to-b from-transparent via-blue-400 to-transparent h-20 animate-scanline"></div>
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                   <h4 className="text-white font-bold text-sm truncate pr-4">
                     {citation?.source_title || 'Unknown Source'}
                   </h4>
                   <span className="text-[10px] text-blue-400 font-mono tracking-tighter uppercase">
                     {citation?.source_type || 'DOCUMENT'}
                   </span>
                </div>

                <div className="text-gray-300 text-xs leading-relaxed mb-4 italic">
                  {citation?.prefetched_content || citation?.excerpt || "No content pre-fetched."}
                </div>

                {citation.pathway && (
                  <div className="mt-2 pt-2 border-t border-white/5 text-[9px] font-mono text-gray-500">
                     <span className="text-blue-500 mr-1">PATHWAY:</span>
                     {citation.pathway.join(' → ')}
                  </div>
                )}
                
                {citation.neural_observation && (
                  <div className="mt-2 p-2 rounded bg-orange-500/10 border border-orange-500/20 text-[10px] text-orange-400 italic">
                    {citation.neural_observation}
                  </div>
                )}
              </div>
              
              {/* Bottom Glow */}
              <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/30 to-transparent"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LiquidCitation;

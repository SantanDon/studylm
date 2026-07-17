import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  CheckCircle2, 
  Loader2, 
  Circle, 
  X, 
  Terminal, 
  MessageSquareCode,
  ListTodo
} from 'lucide-react';

interface ChecklistItem {
  text: string;
  status: 'todo' | 'doing' | 'done';
}

interface TelemetryPulse {
  status: string;
  thought: string;
  activeTask: string;
  lastTool: string;
  checklist: ChecklistItem[];
}

export const AntigravityTelemetry: React.FC<{ notebookId?: string }> = ({ notebookId: _notebookId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [pulse, setPulse] = useState<TelemetryPulse>({
    status: 'idle',
    thought: 'Awaiting connection to Antigravity 2.0...',
    activeTask: 'No active task',
    lastTool: 'none',
    checklist: []
  });

  useEffect(() => {
    const fetchPulse = async () => {
      try {
        const res = await fetch('/api/agent/antigravity/pulse');
        const data = await res.json();
        if (data.success && data.pulse) {
          setPulse(data.pulse);
        }
      } catch (_err) {
        // Keep telemetry failing silently in background
      }
    };

    fetchPulse();
    const interval = setInterval(fetchPulse, 2000);
    return () => clearInterval(interval);
  }, []);

  // Determine status dot color
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'idle':
        return 'bg-zinc-500';
      case 'coding':
        return 'bg-indigo-500 animate-pulse';
      case 'building':
        return 'bg-amber-500 animate-pulse';
      case 'verifying':
        return 'bg-emerald-500 animate-pulse';
      case 'error':
        return 'bg-rose-500 animate-pulse';
      default:
        return 'bg-indigo-500 animate-pulse';
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans">
      <AnimatePresence>
        {isOpen ? (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="w-80 max-h-[450px] flex flex-col bg-zinc-950/90 border border-white/10 rounded-2xl shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] backdrop-blur-xl overflow-hidden text-zinc-200"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${getStatusColor(pulse.status)}`} />
                <span className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-400">Antigravity 2.0</span>
              </div>
              <button 
                onClick={() => setIsOpen(false)} 
                className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
              {/* Telemetry Row */}
              <div className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                <div>
                  <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-1">
                    <Activity className="w-2.5 h-2.5" /> Status
                  </div>
                  <div className="text-xs font-semibold capitalize text-zinc-300 font-mono mt-0.5">{pulse.status}</div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-1 justify-end">
                    <Terminal className="w-2.5 h-2.5" /> Last Tool
                  </div>
                  <div className="text-xs font-mono text-indigo-400 mt-0.5 truncate max-w-[120px]">{pulse.lastTool}</div>
                </div>
              </div>

              {/* Thought Stream */}
              <div className="space-y-1">
                <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-1">
                  <MessageSquareCode className="w-2.5 h-2.5" /> Thought Stream
                </div>
                <p className="text-xs font-mono bg-zinc-900/60 p-3 rounded-xl border border-white/5 leading-relaxed text-zinc-300 italic min-h-[50px]">
                  "{pulse.thought}"
                </p>
              </div>

              {/* Checklist */}
              {pulse.checklist && pulse.checklist.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-1">
                    <ListTodo className="w-2.5 h-2.5" /> Tasks Checklist
                  </div>
                  <div className="space-y-1.5 bg-zinc-900/40 p-3 rounded-xl border border-white/5">
                    {pulse.checklist.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 text-xs py-0.5">
                        <span className="mt-0.5 shrink-0">
                          {item.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          {item.status === 'doing' && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
                          {item.status === 'todo' && <Circle className="w-3.5 h-3.5 text-zinc-600" />}
                        </span>
                        <span className={`leading-snug font-mono ${item.status === 'done' ? 'line-through text-zinc-500' : 'text-zinc-300'}`}>
                          {item.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 border border-dashed border-white/5 rounded-xl text-zinc-600 text-xs font-mono">
                  No active checklist synced.
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.button
            whileHover={{ scale: 1.05, boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            className="w-12 h-12 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-indigo-500 transition-all border border-white/10"
          >
            <Activity className="w-5 h-5 animate-pulse" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};
export default AntigravityTelemetry;

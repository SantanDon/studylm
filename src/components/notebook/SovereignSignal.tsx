import React, { useEffect, useState } from 'react';
import { useSources } from '@/hooks/useSources';
import { useUsageLimits } from '@/hooks/useUsageLimits';
import { motion, AnimatePresence } from 'framer-motion';

const SovereignSignal = ({ notebookId }: { notebookId: string }) => {
  const { sources } = useSources(notebookId);
  const { status } = useUsageLimits();
  const [activeSignal, setActiveSignal] = useState<{
    identity: string;
    timestamp: string;
    farm_health: string;
  } | null>(null);

  useEffect(() => {
    // Find the most recent YouTube source with sovereign_signal metadata
    const youtubeSources = sources
      .filter(s => s.type === 'youtube' && (s.metadata as any)?.sovereign_signal)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (youtubeSources.length > 0) {
      setActiveSignal((youtubeSources[0].metadata as any).sovereign_signal);
    }
  }, [sources]);

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">
          Sovereign Signal
        </h3>
        <div className="flex items-center space-x-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
          <span className="text-[9px] font-bold text-green-500/80 uppercase tracking-tighter">Live</span>
        </div>
      </div>

      <div className="space-y-3">
        <AnimatePresence mode="wait">
          <motion.div 
            key={activeSignal?.identity || 'default'}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-white/40 font-medium">Extraction Farm</span>
              <span className="text-[10px] text-green-400 font-bold uppercase tracking-widest">
                {activeSignal ? activeSignal.farm_health : 'Synchronized'}
              </span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="w-full h-full bg-gradient-to-r from-blue-500/50 to-green-500/50"></div>
            </div>
          </motion.div>
        </AnimatePresence>

        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all duration-300"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-white/40 font-medium">Stealth Identity</span>
            <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">
              {activeSignal ? activeSignal.identity : 'Active Pool'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex -space-x-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="w-5 h-5 rounded-full bg-zinc-800 border-2 border-black flex items-center justify-center">
                  <div className={`w-1.5 h-1.5 rounded-full ${activeSignal ? 'bg-blue-400' : 'bg-white/20'}`}></div>
                </div>
              ))}
              <div className="pl-3 text-[9px] text-white/30 flex items-center">
                {activeSignal ? 'Identity Persisted' : 'Rotating nodes'}
              </div>
            </div>
            {activeSignal && (
              <span className="text-[8px] text-white/20 font-mono">
                {new Date(activeSignal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all duration-300"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-white/40 font-medium">Usage Capacity</span>
            <span className="text-[10px] text-yellow-400 font-bold uppercase tracking-widest">
              {status ? `${status.used} / ${status.limit}` : '-- / --'}
            </span>
          </div>
          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${status ? (status.used / status.limit) * 100 : 0}%` }}
              className={`h-full bg-gradient-to-r from-yellow-500/50 to-orange-500/50 ${status && status.used >= status.limit ? 'animate-pulse' : ''}`}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default SovereignSignal;

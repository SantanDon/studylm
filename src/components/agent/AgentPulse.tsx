import React, { useEffect, useState } from 'react';
import { syncManager } from '../../services/SyncManager';

interface AgentPulseProps {
  notebookId: string;
}

/**
 * AgentPulse
 * 
 * A real-time telemetry component that displays the Council's internal 
 * reasoning and mission status directly in the StudyPod UI.
 */
export const AgentPulse: React.FC<AgentPulseProps> = ({ notebookId }) => {
  const [lastThought, setLastThought] = useState<string>("Awaiting mission sync...");
  const [status, setStatus] = useState<string>("standby");

  useEffect(() => {
    if (!notebookId) return;

    try {
      // Safety check: is the document even ready?
      const doc = (syncManager as any).docs?.get(notebookId);
      if (!doc) {
        console.log(`[AgentPulse] Waiting for notebook doc: ${notebookId}`);
        return;
      }

      const agentState = syncManager.getAgentState(notebookId);
      
      // Initial state
      setLastThought((agentState.get('last_thought') as string) || "Council idling...");
      setStatus((agentState.get('status') as string) || "standby");

      // Listen for real-time updates from the Council (ENI)
      const observer = () => {
        setLastThought((agentState.get('last_thought') as string) || "Council idling...");
        setStatus((agentState.get('status') as string) || "standby");
      };

      agentState.observe(observer);
      
      return () => {
        agentState.unobserve(observer);
      };
    } catch (err) {
      console.warn("[AgentPulse] Could not connect to sync layer:", err);
    }
  }, [notebookId]);

  return (
    <div className={`fixed bottom-4 right-4 p-4 rounded-xl border backdrop-blur-md transition-all duration-500 ${
      status === 'active' ? 'border-green-500/50 bg-green-500/5 shadow-[0_0_20px_rgba(34,197,94,0.2)]' : 'border-white/10 bg-white/5'
    }`}>
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-white/20'}`} />
        <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">Council Telemetry</span>
      </div>
      <div className="w-64 overflow-hidden">
        <p className="text-xs text-white/80 font-mono leading-relaxed truncate">
          {lastThought}
        </p>
      </div>
    </div>
  );
};

import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { ApiService } from '@/services/apiService';

export interface UsageStatus {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

export const useUsageLimits = () => {
  const { session } = useAuth();
  const [status, setStatus] = useState<UsageStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      // We pull this from the user stats endpoint we verified earlier
      const profileData = await ApiService.getUser(session.access_token);
      const stats = profileData.stats || {};
      
      // Defining the generous defaults: 10/day for humans, 50/day for agents
      const limit = profileData.user?.accountType === 'agent' ? 50 : 10;
      const used = stats.youtube_extractions_today || 0;
      
      setStatus({
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
      });
    } catch (err) {
      console.error('Failed to fetch usage status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [session?.access_token]);

  const canExtract = () => {
    if (!status) return true; // Fail open for the first request
    return status.remaining > 0;
  };

  return {
    status,
    loading,
    canExtract,
    refreshStatus: fetchStatus
  };
};

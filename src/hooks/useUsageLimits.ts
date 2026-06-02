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
      setStatus(await ApiService.getYouTubeUsage(session.access_token));
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


import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUsageLimits } from '@/hooks/useUsageLimits';

interface YouTubeUrlInputProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (url: string) => void;
}

const YouTubeUrlInput = ({ open, onOpenChange, onSubmit }: YouTubeUrlInputProps) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { status, canExtract } = useUsageLimits();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    if (!canExtract()) {
      return; // UI should handle this but safety first
    }

    setIsLoading(true);
    try {
      await onSubmit(url.trim());
      setUrl('');
      onOpenChange(false);
    } catch (error) {
      console.error('Error adding YouTube source:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const isLimitReached = status ? status.remaining <= 0 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/5 bg-black/40 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <i className="fi fi-rr-play-alt h-5 w-5 text-red-500"></i>
            </div>
            <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
              YouTube Extraction
            </span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">
          <div className="space-y-3">
            <Label htmlFor="youtube-url" className="text-white/60 text-xs uppercase tracking-widest">
              Video Destination
            </Label>
            <Input
              id="youtube-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="bg-white/5 border-white/10 focus:border-red-500/50 h-12 text-base transition-all duration-300"
              required
            />
            <div className="flex justify-between items-center px-1">
              <p className="text-[10px] text-white/40 italic">
                Paste the full URL to ingest transcripts and metadata.
              </p>
              {status && (
                <div className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full border ${isLimitReached ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-green-500/20 bg-green-500/5 text-green-400/80'} transition-colors duration-500`}>
                  <div className={`w-1 h-1 rounded-full ${isLimitReached ? 'bg-red-500 animate-pulse' : 'bg-green-500'} `} />
                  <span className="text-[10px] font-medium tracking-tight">
                    {status.remaining} / {status.limit} Daily
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex space-x-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 bg-transparent border-white/10 hover:bg-white/5 transition-all"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={`flex-1 ${isLimitReached ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-white text-black hover:bg-zinc-200'} transition-all font-bold`}
              disabled={!url.trim() || isLoading || isLimitReached}
            >
              {isLoading ? 'Ingesting...' : isLimitReached ? 'Limit Reached' : 'Add Source'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default YouTubeUrlInput;

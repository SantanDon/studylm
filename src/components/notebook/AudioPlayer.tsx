import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  Download,
  MoreVertical,
  Trash2,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useAudioPlayer } from "./hooks/useAudioPlayer";

interface AudioPlayerProps {
  audioUrl: string;
  title?: string;
  notebookId?: string;
  mediaId?: string;
  mediaKind?: "podcast" | "audiobook";
  allowDelete?: boolean;
  expiresAt?: string | null;
  onError?: () => void;
  onDeleted?: () => void;
  onRetry?: () => void;
  onUrlRefresh?: (notebookId: string) => void;
}

const AudioPlayer = ({
  audioUrl,
  title = "Deep Dive Conversation",
  notebookId,
  mediaId,
  mediaKind = "podcast",
  allowDelete = true,
  expiresAt,
  onError,
  onDeleted,
  onRetry,
  onUrlRefresh,
}: AudioPlayerProps) => {
  const { state, refs, handlers } = useAudioPlayer({
    audioUrl,
    title,
    notebookId,
    mediaId,
    mediaKind,
    expiresAt,
    onError,
    onDeleted,
    onRetry,
    onUrlRefresh,
  });

  const {
    isPlaying,
    currentTime,
    duration,
    volume,
    loading,
    isDeleting,
    isDownloading,
    audioError,
    autoRetryInProgress,
    playbackRate,
    resumedFrom,
  } = state;
  const { audioRef } = refs;
  const {
    togglePlayPause,
    handleSeek,
    handleVolumeChange,
    handlePlaybackRateChange,
    restart,
    retryLoad,
    downloadAudio,
    deleteAudio,
    formatTime,
  } = handlers;

  return (
    <Card className="p-4 space-y-4">
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h4 className="font-medium text-foreground">{title}</h4>
          {resumedFrom > 0 && (
            <p className="mt-1 text-xs text-muted-foreground" role="status">
              Resumed at {formatTime(resumedFrom)} - progress saves
              automatically
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={isDeleting}>
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreVertical className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={downloadAudio} disabled={isDownloading}>
              {isDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {isDownloading ? "Downloading..." : "Download"}
            </DropdownMenuItem>
            {allowDelete && (
              <DropdownMenuItem
                onClick={deleteAudio}
                className="text-red-600 focus:text-red-600"
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Auto-refresh indicator */}
      {autoRetryInProgress && (
        <div className="flex items-center justify-between p-3 bg-blue-50 rounded-md border border-blue-200">
          <div className="flex items-center space-x-2">
            <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
            <span className="text-sm text-blue-600">
              Refreshing audio access...
            </span>
          </div>
        </div>
      )}

      {/* Error State */}
      {audioError && !autoRetryInProgress && (
        <div className="flex items-center justify-between p-3 bg-red-50 rounded-md border border-red-200">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <span className="text-sm text-red-600">{audioError}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry || retryLoad}
            className="text-red-600 border-red-300 hover:bg-red-50"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Retry
          </Button>
        </div>
      )}

      {/* Progress Bar */}
      <div className="space-y-2">
        <Slider
          value={[currentTime]}
          max={duration || 100}
          step={1}
          onValueChange={handleSeek}
          className="w-full"
          disabled={loading || !!audioError}
          aria-label={`${title} playback position`}
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={restart}
            disabled={loading || !!audioError}
            aria-label="Restart from the beginning"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={togglePlayPause}
            disabled={loading || !!audioError}
            className="w-12"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {loading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            ) : isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-16 px-1 text-xs font-mono"
              >
                {playbackRate}x
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-20">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <DropdownMenuItem
                  key={rate}
                  onClick={() => handlePlaybackRateChange(rate)}
                  className={playbackRate === rate ? "bg-accent" : ""}
                >
                  {rate}x
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Volume Control */}
        <div className="flex items-center space-x-2 w-24">
          <Volume2 className="h-4 w-4 text-gray-500" />
          <Slider
            value={[volume]}
            max={1}
            step={0.1}
            onValueChange={handleVolumeChange}
            className="flex-1"
            aria-label="Volume"
          />
        </div>
      </div>
    </Card>
  );
};

export default AudioPlayer;

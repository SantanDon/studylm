import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// import { Volume2, Play, Settings2 } from 'lucide-react'; // Removed Lucide imports
import { useTTS } from '@/hooks/useTTS';

interface TTSSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const TTSSettingsDialog: React.FC<TTSSettingsDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { voices, settings, updateSettings, speak, stop, isSupported } = useTTS();

  const handlePreview = (voiceName: string) => {
    stop();
    speak("Hello! This is a preview of the selected voice.", voiceName);
  };

  if (!isSupported) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Text-to-Speech Settings</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-center text-gray-500">
            <i className="fi fi-rr-volume h-12 w-12 mx-auto mb-3 text-gray-400"></i>
            <p>Text-to-Speech is not supported in your browser.</p>
            <p className="text-sm mt-2">Try using Chrome, Edge, or Safari.</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const englishVoices = voices.filter(v => v.lang.startsWith('en'));
  const otherVoices = voices.filter(v => !v.lang.startsWith('en'));

  const renderVoiceSelect = (
    label: string,
    value: string,
    onChange: (value: string) => void
  ) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select a voice" />
          </SelectTrigger>
          <SelectContent>
            {englishVoices.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">
                  English Voices
                </div>
                {englishVoices.map((v) => (
                  <SelectItem key={v.voice.name} value={v.voice.name}>
                    {v.label}
                  </SelectItem>
                ))}
              </>
            )}
            {otherVoices.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 mt-2">
                  Other Languages
                </div>
                {otherVoices.map((v) => (
                  <SelectItem key={v.voice.name} value={v.voice.name}>
                    {v.label}
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => handlePreview(value)}
          disabled={!value}
        >
          <i className="fi fi-rr-play h-4 w-4"></i>
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <i className="fi fi-rr-settings-sliders h-5 w-5"></i>
            Text-to-Speech Settings
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {renderVoiceSelect(
            "Host 1 Voice",
            settings.host1Voice,
            (value) => updateSettings({ host1Voice: value })
          )}

          {renderVoiceSelect(
            "Host 2 Voice",
            settings.host2Voice,
            (value) => updateSettings({ host2Voice: value })
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Speech Rate</Label>
              <span className="text-sm text-gray-500">{settings.rate.toFixed(1)}x</span>
            </div>
            <Slider
              value={[settings.rate]}
              onValueChange={([value]) => updateSettings({ rate: value })}
              min={0.5}
              max={2}
              step={0.1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>Slower</span>
              <span>Faster</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Pitch</Label>
              <span className="text-sm text-gray-500">{settings.pitch.toFixed(1)}</span>
            </div>
            <Slider
              value={[settings.pitch]}
              onValueChange={([value]) => updateSettings({ pitch: value })}
              min={0.5}
              max={1.5}
              step={0.1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>Lower</span>
              <span>Higher</span>
            </div>
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs text-gray-500">
              {voices.length} voices available. Voice quality depends on your operating system.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TTSSettingsDialog;

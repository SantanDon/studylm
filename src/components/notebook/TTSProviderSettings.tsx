/**
 * TTS Provider Settings Component
 * Configure Ultimate TTS Studio or Web Speech API for podcast generation
 */

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  getTTSConfig,
  saveTTSConfig,
  TTSConfig,
  getPronunciationDict,
  savePronunciationDict,
} from '@/lib/tts/ttsService';
import {
  getPodcastAudioConfig,
  savePodcastAudioConfig,
  PodcastAudioConfig,
  PodcastAudioGenerator,
} from '@/lib/tts/podcastAudioGenerator';
import { KOKORO_VOICES } from '@/lib/tts/kokoroTTSProvider';

interface TTSProviderSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface VoiceOption {
  id: string;
  name: string;
  gender?: string;
}

const TTSProviderSettings: React.FC<TTSProviderSettingsProps> = ({
  isOpen,
  onClose,
}) => {
  const { toast } = useToast();
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>(getTTSConfig());
  const [audioConfig, setAudioConfig] = useState<PodcastAudioConfig>(getPodcastAudioConfig());
  const [isChecking, setIsChecking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [, setIsLoadingVoices] = useState(false);
  const [pronunciations, setPronunciations] = useState<Array<{ word: string; replacement: string }>>([]);
  const [newWord, setNewWord] = useState('');
  const [newReplacement, setNewReplacement] = useState('');

  useEffect(() => {
    if (isOpen) {
      const config = getTTSConfig();
      setTTSConfig(config);
      setAudioConfig(getPodcastAudioConfig());
      
      // Load pronunciation dictionary
      const dict = getPronunciationDict();
      setPronunciations(Object.entries(dict).map(([word, replacement]) => ({ word, replacement })));

      // Only check connection if provider is ultimate-tts
      if (config.provider === 'ultimate-tts') {
        checkConnection(config.provider, config.endpoint);
      } else {
        setConnectionStatus('unknown');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const checkConnection = async (provider?: string, endpoint?: string): Promise<boolean> => {
    // Only check if provider is ultimate-tts
    if ((provider || ttsConfig.provider) !== 'ultimate-tts') {
      setConnectionStatus('unknown');
      return false;
    }
    
    setIsChecking(true);
    try {
      const checkEndpoint = endpoint || ttsConfig.endpoint;
      const isAvailable = await PodcastAudioGenerator.checkEndpoint(checkEndpoint);
      setConnectionStatus(isAvailable ? 'connected' : 'disconnected');
      
      if (isAvailable) {
        loadVoices();
      }
      return isAvailable;
    } catch {
      setConnectionStatus('disconnected');
      return false;
    } finally {
      setIsChecking(false);
    }
  };

  const loadVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const generator = new PodcastAudioGenerator();
      await generator.initialize();
      const availableVoices = await generator.getAvailableVoices();
      setVoices(availableVoices);
    } catch (error) {
      console.error('Failed to load voices:', error);
    } finally {
      setIsLoadingVoices(false);
    }
  };

  const handleEndpointChange = (endpoint: string) => {
    setTTSConfig(prev => ({ ...prev, endpoint }));
    setConnectionStatus('unknown');
  };

  const handleTestConnection = async () => {
    const isAvailable = await checkConnection();
    if (isAvailable) {
      toast({
        title: '✅ Connected!',
        description: 'Ultimate TTS Studio is available.',
      });
    } else {
      toast({
        title: '❌ Connection Failed',
        description: 'Could not connect to Ultimate TTS Studio. Make sure it\'s running.',
        variant: 'destructive',
      });
    }
  };

  const handleSave = () => {
    saveTTSConfig(ttsConfig);
    savePodcastAudioConfig(audioConfig);

    // Save pronunciation dictionary overrides
    const dict: Record<string, string> = {};
    for (const item of pronunciations) {
      if (item.word.trim() && item.replacement.trim()) {
        dict[item.word.trim().toLowerCase()] = item.replacement.trim();
      }
    }
    savePronunciationDict(dict);

    toast({
      title: 'Settings Saved',
      description: 'TTS settings have been updated.',
    });
    onClose();
  };

  const handleProviderChange = (provider: TTSConfig['provider']) => {
    setTTSConfig(prev => ({ ...prev, provider }));
    if (provider === 'kokoro' || provider === 'web-speech') {
      setConnectionStatus('connected');
      if (provider === 'kokoro') {
        loadVoices(); // Load Kokoro voices
      }
    } else {
      setConnectionStatus('unknown');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <i className="fi fi-rr-microphone-alt h-5 w-5"></i>
            Podcast Audio Settings
          </DialogTitle>
          <DialogDescription>
            Configure text-to-speech for high-quality podcast generation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4 max-h-[50vh] overflow-y-auto pr-2">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label>TTS Provider</Label>
            <Select
              value={ttsConfig.provider}
              onValueChange={(v) => handleProviderChange(v as TTSConfig['provider'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kokoro">
                  <div className="flex items-center gap-2">
                    <span>🎙️ Kokoro TTS</span>
                    <span className="text-xs text-green-600">(Recommended - High Quality)</span>
                  </div>
                </SelectItem>
                <SelectItem value="ultimate-tts">
                  <div className="flex items-center gap-2">
                    <span>🔧 Ultimate TTS Studio</span>
                    <span className="text-xs text-gray-500">(Local Server)</span>
                  </div>
                </SelectItem>
                <SelectItem value="web-speech">
                  <div className="flex items-center gap-2">
                    <span>🔊 Web Speech API</span>
                    <span className="text-xs text-gray-500">(Browser Fallback)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Kokoro TTS Info */}
          {ttsConfig.provider === 'kokoro' && (
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                <i className="fi fi-rr-check-circle"></i>
                Ready to Use - No Setup Required!
              </div>
              <p className="text-sm text-green-600">
                Kokoro TTS runs directly in your browser using AI. The first generation 
                may take a moment to load the model (~80MB), then it's fast!
              </p>
              <p className="text-xs text-green-500 mt-2">
                ✨ High-quality voices • 🔒 100% private • 💰 Completely free
              </p>
            </div>
          )}

          {/* Ultimate TTS Studio Settings */}
          {ttsConfig.provider === 'ultimate-tts' && (
            <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
              <div className="space-y-2">
                <Label>Ultimate TTS Studio Endpoint</Label>
                <div className="flex gap-2">
                  <Input
                    value={ttsConfig.endpoint}
                    onChange={(e) => handleEndpointChange(e.target.value)}
                    placeholder="http://localhost:7860"
                  />
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={isChecking}
                  >
                    {isChecking ? (
                      <i className="fi fi-rr-spinner animate-spin h-4 w-4"></i>
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {connectionStatus === 'connected' && (
                    <span className="text-green-600 flex items-center gap-1">
                      <i className="fi fi-rr-check-circle h-4 w-4"></i>
                      Connected
                    </span>
                  )}
                  {connectionStatus === 'disconnected' && (
                    <span className="text-red-600 flex items-center gap-1">
                      <i className="fi fi-rr-cross-circle h-4 w-4"></i>
                      Not Connected
                    </span>
                  )}
                  {connectionStatus === 'unknown' && (
                    <span className="text-gray-500">Click Test to check connection</span>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-500 space-y-1">
                <p>💡 <strong>Setup Instructions:</strong></p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Install <a href="https://pinokio.computer" target="_blank" rel="noopener" className="text-blue-600 hover:underline">Pinokio</a></li>
                  <li>Search for "Ultimate TTS Studio" and install it</li>
                  <li>Start the server (usually runs on port 7860)</li>
                  <li>Click "Test" above to verify connection</li>
                </ol>
              </div>
            </div>
          )}

          {/* Voice Selection */}
          <div className="space-y-4">
            <Label className="text-base font-medium">Voice Settings</Label>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Host 1 Voice (Main Host)</Label>
                <Select
                  value={audioConfig.host1Voice}
                  onValueChange={(v) => setAudioConfig(prev => ({ ...prev, host1Voice: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {ttsConfig.provider === 'kokoro' ? (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Male Voices</div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === 'male')
                          .map(([id, voice]) => (
                            <SelectItem key={id} value={id}>{voice.name}</SelectItem>
                          ))}
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 mt-2">Female Voices</div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === 'female')
                          .map(([id, voice]) => (
                            <SelectItem key={id} value={id}>{voice.name}</SelectItem>
                          ))}
                      </>
                    ) : voices.length > 0 ? (
                      voices.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="male_1">Male Voice 1</SelectItem>
                        <SelectItem value="male_2">Male Voice 2</SelectItem>
                        <SelectItem value="default">Default</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Host 2 Voice (Co-Host)</Label>
                <Select
                  value={audioConfig.host2Voice}
                  onValueChange={(v) => setAudioConfig(prev => ({ ...prev, host2Voice: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {ttsConfig.provider === 'kokoro' ? (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Female Voices</div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === 'female')
                          .map(([id, voice]) => (
                            <SelectItem key={id} value={id}>{voice.name}</SelectItem>
                          ))}
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 mt-2">Male Voices</div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === 'male')
                          .map(([id, voice]) => (
                            <SelectItem key={id} value={id}>{voice.name}</SelectItem>
                          ))}
                      </>
                    ) : voices.length > 0 ? (
                      voices.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="female_1">Female Voice 1</SelectItem>
                        <SelectItem value="female_2">Female Voice 2</SelectItem>
                        <SelectItem value="default">Default</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Speed Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Speech Speed</Label>
              <span className="text-sm text-gray-500">{audioConfig.speed.toFixed(1)}x</span>
            </div>
            <Slider
              value={[audioConfig.speed]}
              onValueChange={([value]) => setAudioConfig(prev => ({ ...prev, speed: value }))}
              min={0.5}
              max={2.0}
              step={0.1}
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>Slower</span>
              <span>Faster</span>
            </div>
          </div>

          {/* Pause Between Segments */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Pause Between Speakers</Label>
              <span className="text-sm text-gray-500">{audioConfig.pauseBetweenSegments}ms</span>
            </div>
            <Slider
              value={[audioConfig.pauseBetweenSegments]}
              onValueChange={([value]) => setAudioConfig(prev => ({ ...prev, pauseBetweenSegments: value }))}
              min={0}
              max={2000}
              step={100}
            />
          </div>

          {/* Studio Mastering */}
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-3 shadow-sm bg-slate-50 dark:bg-zinc-950/20">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Acoustic Studio Mastering</Label>
              <div className="text-[11px] text-gray-500">
                Enhance sound with stereo panning, presence EQ, and dynamics compression
              </div>
            </div>
            <Checkbox
              checked={audioConfig.enableStudioEQ !== false}
              onCheckedChange={(checked) => 
                setAudioConfig(prev => ({ ...prev, enableStudioEQ: checked === true }))
              }
            />
          </div>

          {/* Pronunciation Overrides */}
          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-semibold flex flex-col gap-1">
              <span>Pronunciation Dictionary</span>
              <span className="text-xs font-normal text-gray-500">
                Override words with custom phonetic spellings
              </span>
            </Label>
            
            <div className="flex gap-2">
              <Input
                placeholder="Word (e.g. studypodlm)"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                className="h-8 text-xs flex-1"
              />
              <Input
                placeholder="Phonetic (e.g. study pod L M)"
                value={newReplacement}
                onChange={(e) => setNewReplacement(e.target.value)}
                className="h-8 text-xs flex-1"
              />
              <Button 
                variant="secondary"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => {
                  if (newWord.trim() && newReplacement.trim()) {
                    setPronunciations(prev => [
                      ...prev.filter(item => item.word.toLowerCase() !== newWord.trim().toLowerCase()),
                      { word: newWord.trim(), replacement: newReplacement.trim() }
                    ]);
                    setNewWord('');
                    setNewReplacement('');
                  }
                }}
              >
                Add
              </Button>
            </div>

            {pronunciations.length > 0 && (
              <div className="border rounded-md divide-y max-h-[120px] overflow-y-auto bg-slate-50 dark:bg-zinc-950/20">
                {pronunciations.map((item) => (
                  <div key={item.word} className="flex items-center justify-between p-2 text-xs">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{item.word}</span>
                    <span className="text-gray-400">→</span>
                    <span className="text-gray-600 dark:text-gray-400 italic">"{item.replacement}"</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-red-500 hover:text-red-700 text-sm font-bold flex items-center justify-center"
                      onClick={() => setPronunciations(prev => prev.filter(p => p.word !== item.word))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Save Button outside scrollable area */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TTSProviderSettings;

/**
 * Visual Effects Settings Component
 * Allows users to customize UI animations and effects
 */

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPalette,
  faWandMagicSparkles,
  faFont,
  faRotate,
} from '@fortawesome/free-solid-svg-icons';
import { useVisualEffectsStore } from '@/stores/visualEffectsStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface VisualEffectsSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const VisualEffectsSettings: React.FC<VisualEffectsSettingsProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    metallicTextEnabled,
    metallicTextSpeed,
    ribbonCursorEnabled,
    ribbonCount,
    ribbonOpacity,
    ribbonThickness,
    useCustomFonts,
    setMetallicTextEnabled,
    setMetallicTextSpeed,
    setRibbonCursorEnabled,
    setRibbonCount,
    setRibbonOpacity,
    setRibbonThickness,
    setUseCustomFonts,
    resetToDefaults,
  } = useVisualEffectsStore();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px] bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <FontAwesomeIcon icon={faPalette} className="text-purple-400" />
            Visual Effects
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Customize animations and visual effects
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Custom Fonts Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <FontAwesomeIcon icon={faFont} className="text-blue-400" />
              Typography
            </div>
            
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <div>
                <Label className="text-slate-200">Custom Fonts</Label>
                <p className="text-xs text-slate-500">
                  Space Grotesk for headings, Source Sans for body
                </p>
              </div>
              <Switch
                checked={useCustomFonts}
                onCheckedChange={setUseCustomFonts}
              />
            </div>
          </div>

          {/* Metallic Text Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <FontAwesomeIcon icon={faWandMagicSparkles} className="text-purple-400" />
              Metallic Text Effect
            </div>
            
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <div>
                <Label className="text-slate-200">Enable Effect</Label>
                <p className="text-xs text-slate-500">
                  Animated gradient on headings
                </p>
              </div>
              <Switch
                checked={metallicTextEnabled}
                onCheckedChange={setMetallicTextEnabled}
              />
            </div>

            {metallicTextEnabled && (
              <div className="p-3 bg-slate-800/50 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <Label className="text-slate-300 text-sm">Animation Speed</Label>
                  <span className="text-xs text-slate-500">{metallicTextSpeed.toFixed(3)}</span>
                </div>
                <Slider
                  value={[metallicTextSpeed]}
                  onValueChange={([value]) => setMetallicTextSpeed(value)}
                  min={0.005}
                  max={0.05}
                  step={0.005}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* Ribbon Cursor Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <FontAwesomeIcon icon={faWandMagicSparkles} className="text-pink-400" />
              Ribbon Cursor Trail
            </div>
            
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <div>
                <Label className="text-slate-200">Enable Effect</Label>
                <p className="text-xs text-slate-500">
                  Colorful ribbon trails follow your cursor
                </p>
              </div>
              <Switch
                checked={ribbonCursorEnabled}
                onCheckedChange={setRibbonCursorEnabled}
              />
            </div>

            {ribbonCursorEnabled && (
              <>
                <div className="p-3 bg-slate-800/50 rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-slate-300 text-sm">Ribbon Count</Label>
                    <span className="text-xs text-slate-500">{ribbonCount}</span>
                  </div>
                  <Slider
                    value={[ribbonCount]}
                    onValueChange={([value]) => setRibbonCount(value)}
                    min={1}
                    max={5}
                    step={1}
                    className="w-full"
                  />
                </div>

                <div className="p-3 bg-slate-800/50 rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-slate-300 text-sm">Opacity</Label>
                    <span className="text-xs text-slate-500">{Math.round(ribbonOpacity * 100)}%</span>
                  </div>
                  <Slider
                    value={[ribbonOpacity]}
                    onValueChange={([value]) => setRibbonOpacity(value)}
                    min={0.1}
                    max={1}
                    step={0.1}
                    className="w-full"
                  />
                </div>

                <div className="p-3 bg-slate-800/50 rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-slate-300 text-sm">Thickness</Label>
                    <span className="text-xs text-slate-500">{ribbonThickness}px</span>
                  </div>
                  <Slider
                    value={[ribbonThickness]}
                    onValueChange={([value]) => setRibbonThickness(value)}
                    min={5}
                    max={40}
                    step={5}
                    className="w-full"
                  />
                </div>
              </>
            )}
          </div>

          {/* Reset Button */}
          <Button
            variant="outline"
            onClick={resetToDefaults}
            className="w-full border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            <FontAwesomeIcon icon={faRotate} className="mr-2" />
            Reset to Defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VisualEffectsSettings;

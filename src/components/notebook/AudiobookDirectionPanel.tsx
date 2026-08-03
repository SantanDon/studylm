import { useMemo, useState } from 'react';
import { BookOpenText, Check, Mic2, Play, Plus, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { PronunciationEntry } from '@/stores/audiobookStore';

export type LiteraryDirection = {
  recommendedPreset?: string;
  confidence?: number;
  rationale?: string;
  signals?: Record<string, number>;
};

export type LiteraryPresetDetail = {
  label?: string;
  description?: string;
};

export type VoiceDetail = {
  name?: string;
  language?: string;
  gender?: string;
  quality?: string;
  provider?: string;
  recommended?: boolean;
  requiresReference?: boolean;
};

export type ProviderDetail = {
  name?: string;
  available?: boolean;
  configured?: boolean;
  description?: string;
  referenceVoiceConfigured?: boolean;
  warming?: boolean;
  modelStatus?: string;
  health?: { status?: string; device?: string; model?: { status?: string } } | null;
};

type PronunciationCandidate = {
  term: string;
  occurrences?: number;
};

interface AudiobookDirectionPanelProps {
  direction?: LiteraryDirection;
  presets: Record<string, LiteraryPresetDetail>;
  selectedStyle: string;
  onStyleChange: (style: string) => void;
  providers: Record<string, ProviderDetail>;
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  voices: string[];
  voiceDetails: Record<string, VoiceDetail>;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  pronunciationCandidates: PronunciationCandidate[];
  pronunciations: PronunciationEntry[];
  onPronunciationsChange: (entries: PronunciationEntry[]) => void;
  onPreview: () => void;
  isPreviewing: boolean;
  previewLabel?: string;
  onWarmExpressive?: () => void;
  isWarmingExpressive?: boolean;
}

const STYLE_ORDER = ['auto', 'faithful', 'immersive', 'scholarly', 'reflective', 'dramatic'];

const confidenceLabel = (confidence?: number) => {
  if (!confidence) return null;
  return `${Math.round(confidence * 100)}% match`;
};

const readableSegment = (value?: string) => value
  ? value.charAt(0).toUpperCase() + value.slice(1)
  : 'Balanced';

export default function AudiobookDirectionPanel({
  direction,
  presets,
  selectedStyle,
  onStyleChange,
  providers,
  selectedProvider,
  onProviderChange,
  voices,
  voiceDetails,
  selectedVoice,
  onVoiceChange,
  pronunciationCandidates,
  pronunciations,
  onPronunciationsChange,
  onPreview,
  isPreviewing,
  previewLabel,
  onWarmExpressive,
  isWarmingExpressive = false,
}: AudiobookDirectionPanelProps) {
  const [newTerm, setNewTerm] = useState('');
  const [newPronunciation, setNewPronunciation] = useState('');

  const compatibleVoices = useMemo(() => voices.filter((voice) => {
    const detail = voiceDetails[voice];
    if (!detail || detail.provider === 'mock') return false;
    if (detail.provider && detail.provider !== selectedProvider) return false;
    if (detail.requiresReference && !providers[selectedProvider]?.referenceVoiceConfigured) return false;
    return true;
  }), [providers, selectedProvider, voiceDetails, voices]);

  const suggestedTerms = useMemo(() => pronunciationCandidates
    .filter((candidate) => !pronunciations.some((entry) => entry.term.toLocaleLowerCase() === candidate.term.toLocaleLowerCase()))
    .slice(0, 8), [pronunciationCandidates, pronunciations]);

  const addEntry = (term = newTerm) => {
    const normalizedTerm = term.trim();
    const normalizedPronunciation = newPronunciation.trim();
    if (!normalizedTerm || !normalizedPronunciation) return;
    const remaining = pronunciations.filter((entry) => entry.term.toLocaleLowerCase() !== normalizedTerm.toLocaleLowerCase());
    onPronunciationsChange([...remaining, { term: normalizedTerm, pronunciation: normalizedPronunciation }]);
    setNewTerm('');
    setNewPronunciation('');
  };

  const recommendation = direction?.recommendedPreset || 'faithful';
  const resolvedLabel = selectedStyle === 'auto'
    ? presets[recommendation]?.label || readableSegment(recommendation)
    : presets[selectedStyle]?.label || readableSegment(selectedStyle);

  return (
    <div className="space-y-4" data-testid="audiobook-direction-panel">
      <Card className="overflow-hidden shadow-sm">
        <div className="border-b border-border bg-primary/[0.04] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <WandSparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Reading direction</h3>
                {direction?.recommendedPreset && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {presets[direction.recommendedPreset]?.label || readableSegment(direction.recommendedPreset)} · {confidenceLabel(direction.confidence)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {direction?.rationale || 'StudyPod will preserve the author’s rhythm and adapt pauses to the writing.'}
              </p>
            </div>
          </div>
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {STYLE_ORDER.filter((style) => style === 'auto' || presets[style]).map((style) => {
            const selected = selectedStyle === style;
            const recommended = style !== 'auto' && direction?.recommendedPreset === style;
            return (
              <button
                key={style}
                type="button"
                onClick={() => onStyleChange(style)}
                className={`rounded-xl border p-3 text-left transition ${selected ? 'border-primary bg-primary/[0.06] ring-1 ring-primary/20' : 'border-border bg-background hover:border-primary/35 hover:bg-muted/40'}`}
                data-testid={`audiobook-style-${style}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {style === 'auto' ? 'Match the book' : presets[style]?.label || readableSegment(style)}
                  </span>
                  {selected ? <Check className="h-3.5 w-3.5 text-primary" /> : recommended ? <Sparkles className="h-3.5 w-3.5 text-primary" /> : null}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {style === 'auto'
                    ? `Use ${presets[recommendation]?.label || readableSegment(recommendation)} for this book and adjust individual reading beats.`
                    : presets[style]?.description || 'Preserve the text with a consistent, natural delivery.'}
                </p>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-4 shadow-sm">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mic2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Narrator</h3>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Choose the voice separately from the literary direction. Current direction: {resolvedLabel}.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Engine</span>
            <select
              value={selectedProvider}
              onChange={(event) => onProviderChange(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
              data-testid="audiobook-provider-select"
            >
              {Object.entries(providers)
                .filter(([key]) => key !== 'mock')
                .map(([key, provider]) => (
                  <option key={key} value={key} disabled={!provider.configured}>
                    {provider.name || key}{provider.available ? '' : provider.warming ? ' · warming' : provider.configured ? ' · warm up first' : ' · unavailable'}
                  </option>
                ))}
            </select>
            {providers[selectedProvider]?.description && (
              <p className="text-[10px] leading-4 text-muted-foreground">{providers[selectedProvider]?.description}</p>
            )}
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Voice</span>
            <select
              value={compatibleVoices.includes(selectedVoice) ? selectedVoice : compatibleVoices[0] || ''}
              onChange={(event) => onVoiceChange(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
              data-testid="audiobook-voice-select"
            >
              {compatibleVoices.map((voice) => (
                <option key={voice} value={voice}>
                  {voiceDetails[voice]?.name || voice}
                  {voiceDetails[voice]?.recommended ? ' · recommended' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedProvider === 'chatterbox' && providers.chatterbox?.configured && !providers.chatterbox.available && (
          <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900/70 dark:bg-violet-950/20" data-testid="chatterbox-warmup-state">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {providers.chatterbox.warming || isWarmingExpressive ? 'Expressive narrator is warming up' : 'Warm up the expressive narrator'}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {providers.chatterbox.warming || isWarmingExpressive
                    ? `The model is loading in the background${providers.chatterbox.health?.device ? ` on ${providers.chatterbox.health.device.toUpperCase()}` : ''}. You can keep using StudyPod.`
                    : 'The first local load may download model files and take several minutes. Later previews start faster.'}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onWarmExpressive}
                disabled={providers.chatterbox.warming || isWarmingExpressive || !onWarmExpressive}
                data-testid="chatterbox-warmup-button"
              >
                <Sparkles className={`h-3.5 w-3.5 ${providers.chatterbox.warming || isWarmingExpressive ? 'animate-pulse' : ''}`} />
                {providers.chatterbox.warming || isWarmingExpressive ? 'Warming' : 'Warm up'}
              </Button>
            </div>
          </div>
        )}
        {selectedProvider === 'chatterbox' && providers.chatterbox?.available && providers.chatterbox.health?.device?.toLowerCase() === 'cpu' && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200" data-testid="chatterbox-cpu-notice">
            Expressive narration is ready on CPU, but synthesis can take much longer than the finished audio. Use Kokoro for practical full-book renders, or leave StudyPod open while Chatterbox works in the background.
          </p>
        )}
        {selectedVoice === 'chatterbox_reference' && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            Reference voice uses only the locally configured recording. Use a recording you created or have permission to use.
          </p>
        )}
      </Card>

      <details className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="audiobook-pronunciation-studio">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <BookOpenText className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-semibold">Pronunciation</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {pronunciations.length ? `${pronunciations.length} correction${pronunciations.length === 1 ? '' : 's'} saved for this book` : 'Review names, places, abbreviations, and specialist terms'}
              </p>
            </div>
          </div>
          <Plus className="h-4 w-4 text-muted-foreground transition group-open:rotate-45" />
        </summary>
        <div className="space-y-3 border-t border-border p-4">
          {suggestedTerms.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Terms worth checking</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedTerms.map((candidate) => (
                  <button
                    key={candidate.term}
                    type="button"
                    onClick={() => setNewTerm(candidate.term)}
                    className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] text-foreground hover:border-primary/40 hover:text-primary"
                  >
                    {candidate.term}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={newTerm}
              onChange={(event) => setNewTerm(event.target.value)}
              placeholder="Written term · Socrates"
              className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              data-testid="audiobook-pronunciation-term"
            />
            <input
              value={newPronunciation}
              onChange={(event) => setNewPronunciation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addEntry();
                }
              }}
              placeholder="Read as · SOCK-ruh-teez"
              className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              data-testid="audiobook-pronunciation-value"
            />
            <Button size="sm" variant="outline" onClick={() => addEntry()} disabled={!newTerm.trim() || !newPronunciation.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          {pronunciations.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border">
              {pronunciations.map((entry) => (
                <div key={entry.term.toLocaleLowerCase()} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{entry.term}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{entry.pronunciation}</span>
                  <button
                    type="button"
                    onClick={() => onPronunciationsChange(pronunciations.filter((item) => item !== entry))}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove pronunciation for ${entry.term}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      <Button
        type="button"
        variant="outline"
        className="w-full justify-center"
        onClick={onPreview}
        disabled={isPreviewing || compatibleVoices.length === 0 || !providers[selectedProvider]?.available}
        data-testid="audiobook-directed-preview"
      >
        {isPreviewing ? <Sparkles className="h-4 w-4 animate-pulse" /> : <Play className="h-4 w-4" />}
        {isPreviewing ? 'Directing a sample…' : `Listen to a sample${previewLabel ? ` · ${previewLabel}` : ''}`}
      </Button>
    </div>
  );
}

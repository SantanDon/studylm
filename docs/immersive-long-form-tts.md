# Immersive long-form TTS architecture

## Goal

StudyPod should create a complete, resumable audiobook from a long PDF or ebook without flattening the book into one giant request, changing narrator voices between chapters, or producing an unmanageably large WAV file.

The pipeline now separates three concerns:

1. **Book understanding** — preserve metadata, front matter, chapter/part boundaries, page ranges, and narration-specific text.
2. **Narration** — clean PDF line wrapping, split at sentence/paragraph boundaries, keep one narrator, cache every section, and expose progress.
3. **Delivery** — join section audio with natural pauses and encode a compact MP3, M4B, or lossless WAV.

## Provider strategy

### Kokoro local — default

Use Kokoro for the default zero-cost local path.

- Lightweight enough for CPU use.
- Fast startup after the first model load.
- Predictable and suitable for chapter previews or complete books.
- StudyPod defaults to the `af_heart` voice through the `immersive_narrator` alias.
- The `immersive` profile keeps one voice for the whole book, uses shorter sentence-aware chunks, and adds paragraph/chapter pauses.

Kokoro remains slightly synthetic on long emotional passages. It is the practical default, not the quality ceiling.

### Chatterbox expressive — optional high-quality path

StudyPod includes an optional local Chatterbox bridge:

- Node integration: `AUDIOBOOK_CHATTERBOX_URL=http://127.0.0.1:4123`
- Bridge: `backend/python/chatterbox_server.py`
- Requirements: `backend/python/requirements-chatterbox.txt`
- Optional reference voice: `CHATTERBOX_REFERENCE_AUDIO=C:\path\to\clean-reference.wav`

Chatterbox is the preferred experimental quality tier because its repository is MIT licensed, supports expressive controls, and can condition on a clean reference clip. The bridge is intentionally separate from the Node process because PyTorch/model dependencies are large and should not inflate the main backend or Vercel bundle.

A 10–20 second clean, single-speaker reference clip is preferable. Only use voices the user owns or has permission to clone.

### Engines evaluated but not selected as defaults

- **F5-TTS:** strong quality and long-form/community tooling, but the official pretrained weights are non-commercial even though the code is MIT. Keep it out of the default product path unless licensing changes or the user supplies compatible weights.
- **Fish Speech S2:** excellent research direction, but the official deployment guidance calls for substantially more VRAM than the current target machine. Not a practical local default.
- **XTTS-v2:** useful multilingual voice cloning and streaming, but its model license is more restrictive than a straightforward permissive product dependency.

## Chatterbox setup

Use Python 3.11 in a dedicated environment:

```powershell
cd backend
py -3.11 -m venv .venv-chatterbox
.\.venv-chatterbox\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r python\requirements-chatterbox.txt
$env:CHATTERBOX_DEVICE = "auto"
# Optional, only for a clean reference voice you own or may use:
# $env:CHATTERBOX_REFERENCE_AUDIO = "C:\path\to\reference.wav"
python python\chatterbox_server.py
```

In the StudyPod backend terminal:

```powershell
$env:AUDIOBOOK_CHATTERBOX_URL = "http://127.0.0.1:4123"
node backend\src\server.js
```

The Audiobook Studio voice-engine selector enables **Chatterbox expressive** only when the bridge URL is configured.

## Long-form quality rules

- Preserve one narrator unless the user deliberately selects a multi-voice production.
- Never split in the middle of a word.
- Prefer paragraph and sentence boundaries; fall back to clauses, then words.
- Remove PDF soft hyphens and reconstruct wrapped lines before synthesis.
- Speak a short opening credit instead of narrating ISBN/catalog/legal boilerplate by default.
- Cache each section independently so an interrupted six-hour book resumes instead of restarting.
- Persist job state to disk so progress survives a backend restart.
- Encode final output as MP3 or M4B; reserve WAV for editing or archival use.
- Keep 0.9–1.2 seconds between chapters and a much shorter pause between synthesis chunks.

## Synchronization roadmap

The next quality layer should follow a Calliope-style approach:

1. Preserve exact text-to-audio timing returned by the TTS engine when available.
2. Produce chapter-level and sentence-level timing manifests.
3. Package EPUB3 media overlays for ebooks.
4. Highlight the currently narrated sentence in StudyPod.
5. Add pronunciation overrides and a review queue for names, acronyms, formulas, and citations.

Forced alignment should be a fallback, not the primary timing source, because alignment drift compounds across long books.

## Real-book validation

Book under test: `The AI-Driven Leader` by Geoff Woods.

- 398 PDF pages
- 23 audiobook sections
- 14 numbered chapters plus parts, conclusion, resources, appendix, acknowledgments, author biography, and shortened opening credits
- 62,798 narration words
- About 6 hours 45 minutes at 155 words per minute before profile speed adjustment
- Beginning, middle, late-book, appendix, and conclusion chat checks passed with structured grounding
- Full 23-section mock audiobook assembled and encoded to a single MP3
- Real Kokoro samples generated for Heart and Bella

Reports and samples live under `.ai-bridge/qa-artifacts/audiobook/`.

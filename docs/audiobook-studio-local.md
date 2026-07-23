# StudyPod Audiobook Studio — local operation

StudyPod turns user-provided EPUB, PDF, TXT, Markdown, and DOCX books into private, resumable audio.

## Backend

- `POST /api/audiobook/extract` — upload, extract, infer metadata, and save a book manifest.
- `GET /api/audiobook/meta` — return metadata and section boundaries.
- `GET /api/audiobook/voices` — voices, narration profiles, and provider availability.
- `GET /api/audiobook/generate/:chapterId` — narrate one section as WAV.
- `POST /api/audiobook/generate-full` — start a complete MP3, M4B, or WAV job.
- `GET /api/audiobook/job-status/:jobId` — persisted progress and resume state.
- `GET /api/audiobook/download/:filename` — download the finished audio.

Book manifests, section audio, and job state are stored under `uploads/` for local development.

## PDF behavior

The PDF path is page-aware. It detects parts, numbered chapters, the conclusion, resources, appendix, acknowledgments, and author biography while preserving page ranges. It also creates shortened narration text for front matter so the audiobook does not read every ISBN and catalog line aloud.

Scanned image-only PDFs still need an OCR stage before narration.

## Default narration

- Provider: `kokoro`
- Voice alias: `immersive_narrator` → `af_heart`
- Style: `immersive`
- Full-book format: `mp3`

The immersive profile keeps one narrator, reconstructs PDF paragraphs, splits at sentence/paragraph boundaries, inserts natural pauses, and caches every section.

The old `soothing_mix` remains for compatibility, but voice rotation is no longer the default because changing speakers chapter by chapter makes a long book feel less coherent.

## Optional expressive provider

See `docs/immersive-long-form-tts.md` for the Chatterbox bridge and the evaluation of other open-source engines.

## Validation

### Small pipeline test

```powershell
node backend/scripts/validate_audiobook_local.js
```

### Real 398-page book extraction

```powershell
node backend/scripts/validate_large_book_audiobook.mjs
```

### Large-book grounded chat

Run with the backend available at port 4000:

```powershell
$env:STUDYPOD_API_URL = "http://127.0.0.1:4000"
node backend/scripts/validate_large_book_chat.mjs
```

The real-book QA reports are saved under `.ai-bridge/qa-artifacts/audiobook/`.

## Safe product boundary

Keep this as a private study/audio feature for material the user owns, created, licensed, or is permitted to process. Do not expose generated copies as a public audiobook-sharing library.

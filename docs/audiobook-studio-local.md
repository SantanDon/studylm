# StudyPod Audiobook Studio — Local Starting Point

This feature turns supported book files into private StudyPod audio. It is local-first and agent-testable, so the pipeline can be checked without paid providers.

## Added backend pieces

- `backend/src/services/audiobookBookService.js`
  - Extracts `.epub`, `.pdf`, `.txt`, `.md`, `.markdown`, and `.docx`.
  - Cleans text and creates chapter records.
  - Saves local manifests for repeatable chapter generation.

- `backend/src/routes/audiobook.js`
  - `POST /api/audiobook/extract` for upload and extraction.
  - `GET /api/audiobook/health` for diagnostics.
  - `GET /api/audiobook/voices` for available voices.
  - `GET /api/audiobook/generate/:chapterId` for one chapter.
  - `POST /api/audiobook/generate-full` for a full-book job.
  - `GET /api/audiobook/job-status/:jobId` for progress.
  - `GET /api/audiobook/download/:filename` for saved WAV files.

## Added frontend pieces

- `src/components/notebook/AudiobookView.tsx`
  - Adds local book upload.
  - Keeps Project Gutenberg import.
  - Uses auth headers for audiobook API calls.
  - Fetches chapter audio as a Blob so authenticated playback works in the browser.
  - Adds an “Add Book” action once the library has books.

- `src/stores/audiobookStore.ts`
  - Defaults to `soothing_mix`.

## Agent validation

- `backend/scripts/validate_audiobook_local.js`
  - Creates a small local sample book.
  - Uploads and extracts it.
  - Generates chapter audio using `provider=mock`.
  - Starts a full-audiobook job.
  - Downloads and validates the merged WAV.

Run from the StudyPod root while the backend is running:

```bash
node backend/scripts/validate_audiobook_local.js
```

Optional values:

```bash
BACKEND_URL=http://127.0.0.1:3001
AUDIOBOOK_ACCESS=guest_audiobook_local
```

The validator uses mock audio on purpose. It proves upload, extraction, auth, manifests, job status, WAV validity, and download flow before testing a real TTS model.

## Narration quality

The real narration path uses open-source Kokoro through `kokoro-js`.

The backend now includes narration profiles:

- `soothing` — calmer audiobook pacing.
- `natural` — balanced general narration.
- `crisp` — clearer study narration.

The default is `soothing`.

The special `soothing_mix` value rotates through compatible voices across chapters to avoid robotic sameness. The route also applies text cleanup before TTS so headings, references, line breaks, and formatting are more speakable.

## Safe product boundary

Keep this as a private study/audio feature for user-owned, user-created, licensed, or public-domain material. Do not turn it into a public audiobook sharing library.

## Known local issue

The verification runner tried to use WSL bash and failed because `/bin/bash` is missing on this Windows setup. Use PowerShell or fix WSL, then run the validator above.

## Next steps

1. Run the local validator.
2. Upload a short `.txt` or `.epub` in Audiobook Studio.
3. Test `mock_narrator` first.
4. Test `soothing_mix` for real Kokoro narration.
5. Listen for pacing, clipped words, awkward pauses, and chapter transitions.
6. Tune `NARRATION_PROFILES` in `backend/src/routes/audiobook.js`.

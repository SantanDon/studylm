# Supadata YouTube Integration

StudyPod uses an open-source-first YouTube extraction chain. Supadata is an optional server-side provider for timestamped transcripts and richer video metadata.

## Provider order

Default:

1. StudyPod InnerTube extractors
2. YouTube transcript library fallback
3. Supadata timestamped transcript fallback
4. Metadata-only source when no transcript is available

Set `SUPADATA_PREFER=1` to try Supadata before the native extractors. This is useful when timestamp consistency matters more than minimizing hosted API usage.

## Server configuration

Configure these only in the backend or deployment environment. Never expose the API key through a `VITE_` variable.

```text
SUPADATA_API_KEY=[REDACTED_SECRET]
SUPADATA_TRANSCRIPT_MODE=native
SUPADATA_TRANSCRIPT_LANGUAGE=en
SUPADATA_METADATA_ENABLED=true
SUPADATA_PREFER=0
SUPADATA_TIMEOUT_MS=30000
SUPADATA_JOB_TIMEOUT_MS=120000
SUPADATA_JOB_POLL_MS=2500
SUPADATA_CHUNK_SIZE=1000
```

`SUPADATA_TRANSCRIPT_MODE` supports:

- `native`: use an existing platform transcript only.
- `auto`: use an existing transcript or generate one when unavailable.
- `generate`: force generated transcription.

StudyPod defaults to `native` to avoid unexpected generated-transcript costs. Enable `auto` or `generate` deliberately and monitor the returned `supadataBillableRequests` metadata.

## Stored source metadata

YouTube sources retain a provider-independent timeline:

```json
{
  "transcriptProvider": "supadata",
  "transcriptMode": "native",
  "transcriptLanguage": "en",
  "timestampedTranscript": true,
  "transcriptSegments": [
    { "text": "Example segment", "offset": 1200, "duration": 800, "lang": "en" }
  ],
  "providerCapabilities": {
    "seekableCitations": true,
    "timestampedSegments": true,
    "metadata": true
  }
}
```

The source viewer turns these offsets into clickable YouTube moments. Paired agents receive the capability summary in notebook context and can request full segments through the source-content endpoint.

## Operational safety

- The key stays server-side.
- Existing native extraction remains available when Supadata is not configured.
- A failed Supadata request does not destroy a successful native extraction.
- Metadata failure does not discard a valid transcript.
- Transcript responses are cached through the normal StudyPod source lifecycle; the provider is not called again when users reopen an existing source.
- Generated transcript modes should be enabled only with an explicit usage budget.

## Verification

Run:

```bash
npx vitest run backend/src/__tests__/supadataService.test.js
npm run typecheck
npm run lint
```

A live Supadata request requires a real `SUPADATA_API_KEY`. Without one, StudyPod reports `configured: false` from `GET /api/youtube/providers` and continues using its native extraction chain.

## Optional yt-dlp fallback

For local or self-hosted runtimes, StudyPod can use `yt-dlp` after the native and JavaScript transcript paths fail. It downloads captions only (`--skip-download`) in JSON3 format, preserves provider timestamps, and deletes its temporary files after parsing.

```env
YTDLP_TRANSCRIPT_ENABLED=1
YTDLP_COMMAND=python
YTDLP_COMMAND_ARGS=-m yt_dlp
YTDLP_TIMEOUT_MS=90000
```

When `YTDLP_TRANSCRIPT_ENABLED` is unset, the fallback is automatically available outside production if a supported command is installed. Production stays disabled unless it is explicitly enabled. StudyPod tries `yt-dlp`, `python -m yt_dlp`, `python3 -m yt_dlp`, and `py -m yt_dlp` without using a shell.

This fallback is optional. If the runtime does not contain `yt-dlp`, StudyPod continues to Supadata or the explicit metadata-only result without fabricating transcript text.

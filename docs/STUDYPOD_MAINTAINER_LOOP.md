# StudyPod Maintainer Loop

StudyPod should be improved through repeatable loops: understand the product cockpit, stabilize the current build, research better patterns, implement narrowly, verify, and record what changed.

## Core product identity

StudyPod is an agent-native study and research cockpit. It is not just a document chat app. Its value comes from turning sources into grounded study conversations, notes, research goals, podcasts/audio, quizzes, concept maps, and agent-readable context.

## Main interface mental model

The main notebook screen is the product center:

- Left panel: sources, source filtering, source inspection, citation context, suggested source intake.
- Center panel: grounded study chat, Agent mode, response-style control, citations, capture buttons, Research Further.
- Right panel: Studio tools such as notes, audio/podcast, Research Goals, quizzes, flashcards, concept maps, source comparison, and future Signal Queue.
- Profile menu: user settings, data management, visual effects, Agent Pairing, API keys, and developer access.

Every improvement should know where it lives in this cockpit before implementation begins.

## The loop

1. Product map: identify the affected panel, route, hook, service, and user flow.
2. Stabilize: fix contract, type, runtime, or deployment issues blocking confidence.
3. Research: look for better patterns from repos, products, papers, or docs.
4. Fit test: only accept ideas that strengthen StudyPod's study/research/agent-native identity.
5. Implement: make a small, reversible change.
6. Verify: run typecheck, build, targeted tests, validators, and UI checks where possible.
7. Record: update `.ai-bridge` with decisions, status, and open questions.

## Fit test for external ideas

A repo or external pattern is useful only if it helps one of these:

- Better source ingestion or extraction.
- Better grounding, citation accuracy, or source inspection.
- Better research planning and synthesis.
- Better long-context notebook organization.
- Better study artifacts: notes, quizzes, audio, flashcards, maps, briefs.
- Better agent-native access through pairing, MCP, notebook context, memory, or safe uploads.
- Better local-first or privacy-first behavior.

Avoid large merges. Prefer small modules, copied patterns, or adapted architecture.

## Current stabilization focus

The current local workspace has strong feature direction, especially Research Goals and Audiobook Studio, but it must be stabilized before more feature work:

- Auth session typing does not match runtime usage.
- Source type schemas do not match runtime source types.
- Research Goals synthesis uses an auth value that is not exposed by the auth context.
- Citation rendering needs cleaner marker/source-citation separation.
- Strict TypeScript checks expose unused imports and inconsistent field names.
- Vercel packaging needs to be checked for newly added backend service files.

## Verification gates

A change is not considered stable until the relevant gates pass:

- `npm run typecheck`
- `npm run build`
- targeted tests or validation scripts for the changed feature
- browser/live UI verification when tooling allows it
- `.ai-bridge/agent-status.md` updated with outcome

## Current feature thread

Audiobook Studio should remain a private study-audio feature for user-owned, user-created, licensed, or public-domain material. The mock provider and local validator are the right diagnostic base. Real narration quality should come after the local contract and build are clean.
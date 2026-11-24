# Architecture

PromptAlong is a client-heavy single-page app. Several people edit one prompt together, one
person presses Send, and everyone sees the same answer stream in. This page summarises the
design decisions; each section names the part of the code that owns it.

## Stack

| Layer         | Choice                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------- |
| Workspace     | pnpm workspaces (`apps/*`, `packages/*`)                                                    |
| Language      | TypeScript, strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)     |
| App           | Vite + React 19, React Router with lazy routes (`/`, `/new`, `/r/:code`, `/demo`, `/about`) |
| Styling       | Tailwind CSS v4 on top of CSS variables generated from `packages/ui/src/tokens/tokens.json` |
| UI primitives | Radix UI (added with the first dialogs and menus)                                           |
| Shared state  | Yjs (CRDT) + y-protocols awareness, y-indexeddb for local persistence                       |
| Prompt editor | TipTap (ProseMirror) + y-prosemirror                                                        |
| Backend       | Supabase free tier: Realtime broadcast, Postgres with row-level security, anonymous auth    |
| Hosting       | Vercel Hobby, static build with an SPA rewrite                                              |
| Tests         | Vitest, Testing Library, Playwright (several browser contexts per test), axe-core           |
| Fonts         | Space Grotesk, Inter, JetBrains Mono, self-hosted via @fontsource (SIL OFL 1.1)             |

Everything runs on free tiers. Dependencies are limited to permissive licences, checked in CI by
`scripts/check-licenses.mjs`.

## Packages

```
apps/web            the app: landing, lobby, room, settings
packages/core       room document model, provenance, conversation tree, context assembly
packages/providers  one provider interface; mock, bring-your-own-key, in-browser and local backends
packages/ui         design tokens and shared components
packages/config     TypeScript, ESLint, Prettier and Tailwind presets
supabase/           migrations and RLS policies
e2e/                Playwright tests
```

## Realtime

- One Yjs document per room holds the prompt (TipTap fragment), turns, branches, context items,
  room settings and the people list. No secrets are ever stored in it.
- Updates travel over a private Supabase Realtime broadcast channel `room:{id}`, coalesced every
  50 ms while typing (100 ms in rooms with more than three people) to stay inside the free
  message limits. Joining peers sync with a state-vector exchange; if nobody answers, the latest
  snapshot is loaded from Postgres.
- Cursors and selections use y-protocols awareness on the same channel (at most one update per
  100 ms per person). Supabase Presence only drives the coarse "who is online" list.
- Edits are stored locally with y-indexeddb, so typing continues offline and merges on reconnect.
  A peer-to-peer fallback (y-webrtc, signalled over the same channel) is evaluated as a spike.

## Models and keys

`packages/providers` exposes one interface:

```ts
interface Provider {
  kind: 'mock' | 'byok' | 'webllm' | 'ollama';
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
  listModels(): Promise<ModelInfo[]>;
  buildRequestBody(req: ChatRequest): string; // the exact bytes shown in the context panel
  stream(body: string, signal: AbortSignal): AsyncIterable<StreamChunk>;
}
```

- **Mock**: scripted, deterministic streams with no network. Default for the public demo and tests.
- **Bring your own key**: OpenAI-compatible streaming over `fetch`, from the browser straight to
  the chosen provider.
- **In-browser**: a WebGPU model, lazy-loaded and run in a worker.
- **Local**: a model server on `localhost`.

A person's key is stored only in their own browser (IndexedDB, encrypted at rest with a
non-extractable key), never in the room document, the database, URLs, logs or exports. The
room only records `{ kind, model }`. Only the sender's browser calls the model; answer chunks
are broadcast to the room as plain text every ~150 ms, so everyone sees one stream without
anyone sharing a key.

## Provenance and the conversation tree

- Text typed by each person carries an `author` mark in the editor, so the prompt always shows
  who wrote what.
- Each Send freezes a turn: the prompt text with author ranges, the context items included, the
  model, the SHA-256 of the exact request body, and the answer.
- Branches have their own draft prompt. Turns form a tree through `parentTurnId`; rooms can be
  forked, two turns compared word by word, and a branch's prompt changes merged back.

## Context and token budget

- Each person can attach notes, snippets and text files (text only, up to 200 KB each, 20 per room).
- One pure function, `assemble(room, branch)`, builds the request in a fixed order: optional room
  system line, included context items, branch history, current draft. The payload tab renders the
  same string that Send posts. Nothing hidden is added.
- Token counts run in a worker in the browser; exact for encodings the tokenizer knows, marked
  "about" otherwise. Send is disabled when the request is over the model's budget.

## Rooms and access

- Anonymous sign-in gives every browser a real user id without email.
- Rooms have a 6-character code from a 31-character alphabet without look-alike characters
  (`packages/core/src/room-code.ts`), up to 8 people, and a host who can lock the room.
- Joining goes through a `join_room(code)` SQL function. Every table has RLS; channel messages
  are restricted to room members. Room creation and join attempts are rate-limited per user.

## Quality gates

Every pull request runs: no-trace check, licence allow-list, ESLint, Prettier, TypeScript, Vitest,
production build, first-load JS budget, Playwright smoke tests and axe accessibility checks.

Performance budgets:

- first-load JS under 200 KB gzip (model runtime and tokenizer are lazy);
- keystroke to remote cursor under 300 ms;
- a streamed token visible to everyone in under 1 s;
- Lighthouse score of 90 or more.

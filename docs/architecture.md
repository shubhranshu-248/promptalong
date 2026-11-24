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

- One Yjs document per room holds the prompt (a ProseMirror fragment), the room settings and the
  people list; later it also holds turns, branches and context items. No secrets are ever stored in it.
- `packages/core/src/sync` keeps the document and awareness in sync over a small broadcast
  `Transport` interface:
  - joining or reconnecting peers exchange state vectors in both directions, so edits made offline
    are merged in, never overwritten;
  - local edits are batched every 50 ms (100 ms with more than three people) into one update with a
    per-sender sequence number; broadcast delivery is at-most-once, so a gap in a sender's sequence
    triggers a targeted re-sync, and a light re-sync runs every 20 s (nobody answers when nothing
    is missing);
  - cursors, selections, names and "typing / selecting" come from y-protocols awareness, at most
    one message per 100 ms per person. The people list is built from awareness too.
- Transports (`apps/web/src/realtime`):
  - **Supabase Realtime broadcast** on channel `room:{code}` (supabase-js is lazy-loaded);
  - a **local relay** (`scripts/dev-relay.mjs`) with the same broadcast behaviour, used in
    development and by the end-to-end tests, so CI needs no hosted service;
  - **this device only** when neither is configured.
- Every room is also stored in the browser with y-indexeddb, so typing continues offline and syncs
  when the connection returns. The editor appears once the local copy has loaded and the first sync
  has answered, so nobody starts typing into an outdated document.
- Colour slots (1-8) are handed out in join order. Each browser picks only its own slot from what it
  sees, with one shared tie-break (earlier visit first, then id), so simultaneous joins never keep the
  same colour. A ninth person sees "room full".
- Until the persistence phase, a room is its code: name and "who can Send" live in the document,
  written once by the creator, and the channel is public (the code works as the invite). That phase
  moves rooms to Postgres with private, member-only channels.

### Editor binding

- TipTap (ProseMirror) bound to Yjs with upstream `y-prosemirror` through a small extension
  (`apps/web/src/room/yjs-collaboration.ts`): shared content, remote carets with name labels, and an
  undo that only reverts the current person's edits.
- A room starts with one paragraph that already holds one shared text node. If every editor created
  its own first text node, people typing their first letters at the same moment could see letters
  duplicated when the editor merges neighbouring text nodes.
- The editor component never re-renders while someone is typing (React re-renders would call
  `setOptions` in the middle of ProseMirror handling a keystroke).

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
room only records `{ kind, model, endpoint, setBy }`. Only the sender's browser calls the model;
it appends the answer to the turn's shared text every ~150 ms, so everyone sees one stream (and
late joiners the answer so far) without anyone sharing a key.

### One stream at a time

- A send lock in the room document (sender, turn, heartbeat every 2 s). Others treat it as gone
  after 10 s without a heartbeat and mark the turn interrupted; a sender who closes the page does
  that at once.
- With others online the sender waits ~300 ms after taking the lock and only calls the model if
  the lock is still theirs, so two Sends at the same moment never both reach a model.
- Anyone can press Stop: the sender's browser cancels the request and the answer so far is kept.

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
production build, first-load JS budget, and Playwright end-to-end tests over the local relay: two to
four people typing at once (no lost or duplicated characters), a network cut and reconnect, reload
and late join, per-person undo, keystroke-to-other-screen latency, the 8-person limit, and axe
accessibility checks.

Performance budgets:

- first-load JS under 200 KB gzip (model runtime and tokenizer are lazy);
- keystroke to remote cursor under 300 ms;
- a streamed token visible to everyone in under 1 s;
- Lighthouse score of 90 or more.

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
  - **Supabase Realtime broadcast** on the private channel `room:{room id}`, open only to people
    with a seat (supabase-js is lazy-loaded);
  - a **local relay** (`scripts/dev-relay.mjs`) with the same broadcast behaviour, used in
    development and by the end-to-end tests, so CI needs no hosted service;
  - **this device only** when neither is configured.
- Every room is also stored in the browser with y-indexeddb, so typing continues offline and syncs
  when the connection returns. The editor appears once the local copy has loaded and the first sync
  has answered, so nobody starts typing into an outdated document.
- Colour slots (1-8) are handed out in join order. Each browser picks only its own slot from what it
  sees, with one shared tie-break (earlier visit first, then id), so simultaneous joins never keep the
  same colour. A ninth person sees "room full".
- Room settings that everyone must see at once (name, "who can Send") live in the document; who
  may join, lock, remove and delete is decided by the database (see Rooms and access).

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
- Branches have their own draft prompt (`draft:{id}`; main keeps `prompt`). A new branch's draft
  starts as the prompt that came next on its source (edit and retry); that prompt is also the
  merge base. `settings.activeBranch` decides which draft the shared editor shows, for everyone.
- Turns form a tree through `parentId`; a branch's history is the parent chain from its newest
  turn. Labels: T1, T2… on main, T2b, T3b… on branches.
- Compare: a word diff of two prompts (a small LCS in `packages/core`, no dependency), added words
  underlined in their writer's colour, answers side by side.
- Merge: a three-way merge per paragraph. Each side is its draft, or its last sent prompt when
  the draft is empty. Conflicts are resolved as ours / theirs / both; only changed paragraphs are
  rewritten, so people typing elsewhere lose nothing. Each merge is recorded (who, from, into).
- Fork room: a new room gets the turns along the chosen path and a frozen list of their authors,
  marked with the room they came from. Nothing is ever deleted.

## Context and token budget

- Each person can attach notes, snippets and `.txt` / `.md` files (text only, UTF-8, up to 200 KB
  each, 20 per room). Files are read in the browser; the text goes into the room document. Each
  item is its own map, so including or excluding it (anyone can, and the room sees who did) never
  re-sends its text. The owner can edit an item; the owner or the host can remove it.
- One pure function, `assemble` (`packages/core/src/context`), builds the request in a fixed order:
  one leading system message holding the optional room line and every included item in creation
  order, each as `[context: {title} · {owner}]` + new line + text, separated by a blank line; then
  the branch history; then the draft prompt. With no room line and nothing included there is no
  system message. Owner names are read from the room document only, so every browser builds the
  same bytes.
- The Payload tab and Send call the same two functions (`assembleRoom`, then the provider's
  `buildRequestBody`): the string shown is the string posted. Its SHA-256 is shown in the panel
  and stored on the turn as `requestHash`. Each turn also freezes the context it used (title,
  owner, size, tokens, SHA-256 of the text) and the room line.
- Token counts run in a Web Worker (`gpt-tokenizer`, o200k_base), loaded on first use and cached
  per text. They are exact for models that use that encoding; a model running in the browser is
  counted with its own tokenizer once it is started; everything else is marked "about".
- Budget = context window - room kept for the answer (1,024 tokens, or a quarter of a small
  window). The bar shows prompt + history and each person's context. Over budget, Send is off for
  everyone with "remove about N tokens"; nothing is trimmed silently.
- Fork room copies the context items and the room line; compare shows what each turn used.

## Rooms and access

- Identity: on first use the browser signs in anonymously (Supabase Anonymous Sign-Ins), which
  gives it a real user id without an email. That id is the participant id on everything the
  person writes.
- Rooms have a 6-character code from a 31-character alphabet without look-alike characters
  (`packages/core/src/room-code.ts`) and hold up to 8 people.
- The database (`supabase/migrations`): `rooms`, `room_members`, `room_snapshots` and a rate-limit
  table. Row-level security is on for every table: members can read their own room's rows and
  nobody writes a table directly. Every write goes through SQL functions that check the caller
  (`create_room`, `join_room`, `touch_room`, `leave_room`, `set_room_locked`, `remove_member`,
  `transfer_host`, `delete_room`, `save_snapshot`, `load_snapshot`).
- `join_room` refuses when the room does not exist, the person was removed, the room is locked
  (people who already have a seat may come back) or 8 people are active. A seat is active for
  90 seconds after its last heartbeat (`touch_room`, every 30 seconds). Limits per person: 5 new
  rooms and 30 counted join attempts an hour.
- The live channel is private: policies on `realtime.messages` let only people with a seat receive
  and send on `room:{id}`.
- The host can lock the room, remove a person (for good), hand the room to someone else, or
  delete it. The room document mirrors lock, removals and deletion so everyone sees them at once;
  a browser that sees itself removed asks the server before leaving, so a mark written by someone
  else does nothing.
- Snapshots: the person who has been in the room longest saves the whole document 10 seconds after
  a change, at least every 30 seconds while changes keep coming, and when they leave. A joiner
  loads the snapshot, so a room opens with its content when nobody else is online.
- Rooms idle for 30 days are deleted (`delete_idle_rooms`, daily with pg_cron when it is enabled).
- One interface, three backends (`apps/web/src/backend`): the Supabase project, the local relay
  with the same rules in memory (development and tests need no hosted service), and "this device
  only" when nothing is configured.

## Export

Any branch exports as Markdown (readable) or JSON (prompt segments with authors, context, model,
request hash, the branch tree), with or without context and author names. It is built in the
browser from the room document, which never holds a model key.

## Live demo

`/demo` opens a room that exists only in the page (`apps/web/src/demo`). Three scripted teammates
and the visitor are each a full room session on an in-page channel (the same `MemoryHub` the unit
tests use), so the demo runs the real sync, authorship, context, branch and stream code - but no
server, no relay and no model account are involved, and nothing is saved. The teammates type into
the shared prompt letter by letter (word by word with reduced motion) with their own author marks
and carets, add and exclude context, start a branch and press Send with the demo model; turn 3 is
left in the prompt for the visitor. The room's model cannot be changed in the demo, so no key
stored in the visitor's browser can be used by a scripted person. Replay starts an empty room.

## Answers

Answers are shown as formatted text by a small Markdown reader (`apps/web/src/room/markdown.ts`):
paragraphs, headings, lists, quotes, code, tables, bold / italic / inline code and http(s) links.
It builds React elements, never HTML strings, so nothing in an answer can add markup or scripts,
and it reads half-written input while an answer streams (an unclosed `**` stays text until the
rest arrives; a table appears once its separator row has).

## Security headers

`apps/web/vercel.json` sends a Content-Security-Policy (scripts only from the site itself, plus
WebAssembly for the in-browser model; connections only to Supabase, the four key providers,
Ollama on localhost and the in-browser model's download hosts; no framing, no plugins),
`X-Frame-Options`, `nosniff`, a strict referrer policy, HSTS and a same-origin opener policy.
`vite preview` sends the same headers, so every end-to-end test runs under the production policy.

## Quality gates

Every pull request runs: no-trace check, licence allow-list, ESLint, Prettier, TypeScript, Vitest,
production build, first-load JS budget, and Playwright end-to-end tests over the local relay: two to
four people typing at once (no lost or duplicated characters), a network cut and reconnect, reload
and late join, per-person undo, keystroke-to-other-screen latency, the 8-person limit, payload
equality (the panel's string is the intercepted request body and hashes to the stored request
hash), a context toggle reaching everyone in under a second, and axe accessibility checks.

Performance budgets:

- first-load JS under 200 KB gzip (model runtime and tokenizer are lazy);
- keystroke to remote cursor under 300 ms;
- a streamed token visible to everyone in under 1 s;
- Lighthouse score of 90 or more.

## Deployment

The app is a static build on Vercel (`apps/web/vercel.json`: SPA rewrite, long-lived cache for
hashed assets, security headers). `main` deploys to production at
[promptalong.vercel.app](https://promptalong.vercel.app); every pull request gets a preview.
The Supabase project (free tier, Mumbai) holds rooms and snapshots and carries the live channels.
Moving to another address is described in [runbooks/deploy.md](runbooks/deploy.md).

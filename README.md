<p align="center">
  <img src="apps/web/public/favicon.svg" width="72" height="72" alt="">
</p>

<h1 align="center">PromptAlong</h1>

<p align="center"><strong>Everyone prompts. One answer.</strong><br>
Like a sing-along, but for AI.</p>

PromptAlong is a real-time multiplayer prompting workspace. Several people co-write **one**
prompt with live cursors, one person presses **Send**, and everyone watches the **same** answer
stream in. It works with any model, including free ones.

Student teams, hackathon teams and study groups usually work on separate machines and separate
accounts, copy-pasting prompts and answers back and forth. PromptAlong gives them one shared
prompt, one shared answer and one shared history.

> Status: early development. Rooms, live co-writing (shared prompt, live cursors, offline editing
> that syncs back) and the shared answer work: anyone presses Send and everyone watches the same
> answer stream in, from the demo model, your own key, a model in your browser or Ollama.
> Every prompt shows who wrote which part, and the conversation branches like a git history:
> branch from any turn, compare two turns, merge prompt changes back, or fork the room.
> Everyone can attach notes, snippets and text files as context; the panel shows the exact
> request body before it is sent, with a live token budget. Rooms are saved on the server, so a
> room opens with its content even when nobody else is online; the host can lock a room, remove
> people or delete it; any branch exports to Markdown or JSON.

## What makes it different

1. **Shared prompt, shared stream** - multi-cursor editing of one prompt (CRDT), one Send, one
   token stream that every participant sees live.
2. **Prompt provenance** - every part of the prompt keeps its author; branch, fork, compare and
   merge the conversation like code.
3. **Context transparency** - everyone attaches their own context, and a panel shows exactly
   what the model will receive with a live token budget.
4. **Any model, zero cost** - a scripted demo model, your own key (kept in your browser), a model
   running in your browser, or one running on your laptop.

## Stack

Vite, React 19, TypeScript (strict), React Router, Tailwind CSS v4, Yjs, TipTap, Supabase
(Realtime, Postgres with RLS, anonymous auth), Vitest, Playwright, axe-core. Hosted on Vercel.
See [docs/architecture.md](docs/architecture.md) for the design.

```
apps/web            the app
packages/core       room model, provenance, conversation tree, context assembly
packages/providers  model provider interface and backends
packages/ui         design tokens and components
packages/config     shared TypeScript / ESLint / Prettier / Tailwind config
packages/db         tests of the database rules on an in-process Postgres
supabase/           migrations, RLS policies and the local stack config
e2e/                Playwright tests
```

## Run it locally

Requirements: Node 22+ and pnpm (the version is pinned in `package.json`; with Corepack run
`corepack enable`).

```bash
pnpm install
pnpm relay               # terminal 1: local sync relay on ws://localhost:8787
pnpm dev                 # terminal 2: http://localhost:5173
```

Open the same room link in two browsers (or a normal and a private window) to write together.
The relay stands in for the hosted backend with the same room rules, kept in memory (rooms are
forgotten when it stops). Without it the app still works, but each browser only sees its own copy.

Useful scripts:

| Command                                                 | What it does                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm test`                                             | unit tests (Vitest) in every package                                                       |
| `pnpm lint` / `pnpm typecheck`                          | ESLint / TypeScript                                                                        |
| `pnpm build`                                            | production build of the app                                                                |
| `pnpm exec playwright install chromium` then `pnpm e2e` | end-to-end tests: 2-9 browsers writing together, offline/reconnect, latency, accessibility |
| `pnpm check`                                            | every CI gate except E2E                                                                   |

Environment variables are listed in [`.env.example`](.env.example). Locally nothing is needed: rooms
sync through the relay. With `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set, the app uses that
Supabase project: anonymous sign-in, rooms and snapshots in Postgres behind row-level security, and a
private Realtime channel per room. Setting one up, locally or hosted, is described in
[docs/runbooks/database.md](docs/runbooks/database.md).

## Privacy

Your model key never leaves your browser: it is not synced to other people, not sent to any
PromptAlong server, and not logged. Only your browser talks to the model provider you choose.
No table in the database has a column for a key.

Anyone with a room's code can join it until the host locks it. People in a room can read
everything in it, so do not paste secrets into a shared prompt.

## Licence

[MIT](LICENSE) © 2026 Shubhranshu Sahu

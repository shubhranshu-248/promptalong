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

> Status: early development. The landing page and the project tooling are in place; rooms,
> the shared editor and model streaming are being built next.

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
supabase/           migrations and RLS policies
e2e/                Playwright tests
```

## Run it locally

Requirements: Node 22+ and pnpm (the version is pinned in `package.json`; with Corepack run
`corepack enable`).

```bash
pnpm install
pnpm dev                 # http://localhost:5173
```

Useful scripts:

| Command                                                 | What it does                                        |
| ------------------------------------------------------- | --------------------------------------------------- |
| `pnpm test`                                             | unit tests (Vitest) in every package                |
| `pnpm lint` / `pnpm typecheck`                          | ESLint / TypeScript                                 |
| `pnpm build`                                            | production build of the app                         |
| `pnpm exec playwright install chromium` then `pnpm e2e` | smoke and accessibility tests against the built app |
| `pnpm check`                                            | every CI gate except E2E                            |

Environment variables are listed in [`.env.example`](.env.example). Nothing is needed to run the
landing page.

## Privacy

Your model key never leaves your browser: it is not synced to other people, not sent to any
PromptAlong server, and not logged. Only your browser talks to the model provider you choose.

## Licence

[MIT](LICENSE) © 2026 Shubhranshu Sahu

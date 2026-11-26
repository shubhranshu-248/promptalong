# PromptAlong - case study

**Everyone prompts. One answer.** A real-time multiplayer prompting workspace: a team co-writes
one prompt with live cursors, one person presses Send, and everyone watches the same AI answer
stream in.

- Live: [promptalong.vercel.app](https://promptalong.vercel.app) - the
  [demo](https://promptalong.vercel.app/demo) needs no sign-up and no key
- Team: Shubhranshu Sahu and Sidak Kaur Gurpreet Singh Sachdev - product, design, architecture, code,
  tests, deployment
- Built: November 2026
- Stack: TypeScript, React, Yjs, TipTap, Supabase (Realtime, Postgres, RLS), Vercel, Playwright
- Cost to run: zero (free tiers only)

## The problem

When our teams work with AI - in a hackathon, on a lab report, in a study group - everyone sits at
their own laptop with their own chat. One person writes a prompt, pastes the answer into the group
chat, somebody else improves the prompt in their own window, and soon there are four versions of
the prompt, four answers and nobody knows which one the slides came from.

Chat apps let a team share files and instructions, but nobody writes the prompt _together_. That
gap is the product: Google Docs for the prompt, not just for the output.

## The idea in four parts

1. **Shared prompt, shared stream.** One prompt with everyone's cursor in it. One Send. One answer
   that streams in on every screen at the same moment.
2. **Provenance.** Every word of the prompt keeps its writer, and the conversation is a tree you can
   branch, fork, compare and merge - git for prompting.
3. **Honest context.** Everyone can attach notes and files, and a panel shows the exact bytes the
   model will receive, with a live token budget.
4. **Any model, no cost.** A scripted demo model, your own key (which never leaves your browser),
   a model running in the browser on WebGPU, or Ollama on your laptop.

What we deliberately did **not** build: an own language model or a search engine. PromptAlong is
the multiplayer layer over models that already exist.

## Design

We started with flows and mockups for every screen at desktop (1440 px) and phone (390 px) width
before writing code, plus a small brand: three coloured strands that meet in one dot - three
people, one answer. Presence colours had to stay apart for eight people and pass contrast checks
in both themes, and colour is never the only cue: every caret and authorship span also carries a
name.

## Hard problems and how we solved them

**Letters landing in the wrong place.** CRDTs (we used Yjs) guarantee that everyone ends up with the
same text, but not that it reads well. When two people typed at the very end of the prompt at the
same instant, their letters could interleave: "andK speaker notes. eep". The cause was the caret:
after a remote insert, the local caret moved to the right of the other person's letters. We
attached each caret to the letter _before_ it instead, so each person keeps typing after their own
text. A test where a visitor types along with a scripted teammate went from failing 9 of 15 runs
to passing 15 of 15 in three browsers.

**Two Sends at the same moment.** If two people press Send together, the model must be called
once. A send lock lives in the shared document with a heartbeat every 2 s; with others online, the
sender waits 300 ms after taking it and only calls the model if the lock is still theirs. Anyone
can press Stop, and if the sender closes the tab the answer so far is kept and marked interrupted.
We also found (through a test) that reading the prompt at the click but clearing it after the
300 ms window lost the letters a co-writer typed in between - now the prompt is read, frozen and
cleared in one step.

**Sharing the answer without sharing the key.** Only the sender's browser talks to the model.
It appends the answer to the turn in the shared document every ~150 ms, so everyone sees one
stream and a late joiner sees the answer so far. A person's own key is stored only in their
browser (encrypted at rest with a non-extractable key) and an end-to-end test intercepts every
request to prove it goes to the chosen provider and nowhere else.

**What you see is what is sent.** The context panel and the Send button call the same two pure
functions, so the string on screen is the string posted. Its SHA-256 is shown and stored with the
turn, and a test compares the panel's text with the intercepted request body byte for byte.
Token counting runs in a Web Worker that only loads when it is needed - loading it in every room
had made typing noticeably slower.

**Realtime on a free tier.** Supabase's free Realtime plan allows 100 messages per second per
project. Edits are batched every 50-100 ms with a per-sender sequence number; a gap triggers a
targeted re-sync instead of re-sending everything. Each browser also keeps the room in IndexedDB,
so typing continues offline and merges when the connection returns.

**Rooms that are actually private.** Rooms, members and snapshots live in Postgres with row-level
security on every table; nobody writes a table directly - every write is a SQL function that
checks the caller and answers `{ ok, reason }`. Live messages go over a private channel that only
people with a seat can join. The rules are tested in CI against an in-process Postgres, and against
a real local Supabase stack before release.

**A demo that shows everything without a server.** The live demo is a real room that exists only
in the page: three scripted teammates and the visitor are each a full room session on an in-page
channel, so it runs the same sync, authorship, context, branch and stream code as a real room -
with zero network requests. It went from a Lighthouse mobile score of 77 to 88 by drawing a light
first view while the editor code loads and letting the teammates join when the page is idle.

**Security headers that are tested, not hoped for.** The production Content-Security-Policy only
allows scripts from the site itself and connections to Supabase and the model providers. The
local preview server reads the same header file, so every one of the end-to-end tests runs under
the production policy and a change that breaks the app fails CI.

## Testing

- 245 unit tests and 80 end-to-end tests, run in Chromium, Firefox and WebKit, with two to nine
  separate browsers per test (people typing at once, network cut and reconnect, the eighth and
  ninth person, one Send seen by all, key isolation, payload equality, branch and merge, room
  rules, accessibility with axe).
- Measured budgets: first-load JavaScript 104.5 KB gzip (limit 200), keystroke to another screen
  well under the 300 ms budget (p95 70-190 ms), a streamed token on every screen in under 1 s,
  Lighthouse 88-100 across pages and devices.
- CI blocks a merge on lint, types, formatting, unit tests, the build, the JavaScript budget and a
  licence allow-list (permissive licences only).

## What we learned

- A CRDT solves the hard merge problem, but the experience lives in details around it: where the
  caret goes, who sees a change first, what happens when someone closes a tab mid-answer.
- Multi-browser end-to-end tests found most of the real bugs - things a single-user test never
  sees, like a letter typed during a 300 ms window or a save cut off when a tab closes.
- Free tiers are enough for a real product if the design respects their limits from the start.

## What we would do next

- Voice presence for teams in different places.
- Room templates for common tasks (pitch, lab report, revision notes).
- More than eight people per room for classrooms.

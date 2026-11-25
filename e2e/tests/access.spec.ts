import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  closeAll,
  createRoom,
  focusEnd,
  joinRoom,
  person,
  promptText,
  type Person,
} from './helpers';

async function write(p: Person, text: string): Promise<void> {
  await focusEnd(p);
  await p.page.keyboard.type(text);
}

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}

async function openRoomMenu(p: Person): Promise<void> {
  await p.page.getByRole('button', { name: 'Room menu' }).click();
}

test.describe('room access', () => {
  test('a code nobody created: "No room with code …"', async ({ browser }) => {
    const meera = await person(browser, 'Meera');
    try {
      await meera.page.goto('/r/ZZZZZ9');
      const screen = meera.page.getByTestId('room-not-found');
      await expect(screen).toBeVisible();
      await expect(screen.getByRole('heading')).toHaveText('No room with code ZZZ-ZZ9');
      await expect(screen).toContainText('Rooms idle for 30 days are deleted.');
      expect(await axe(meera.page)).toEqual([]);
      await screen.getByRole('link', { name: 'Enter another code' }).click();
      await expect(meera.page).toHaveURL(/\/new#join$/u);
    } finally {
      await closeAll([meera]);
    }
  });

  test('lock: new people are refused, people with a seat come back, unlock lets them in', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const kabir = await person(browser, 'Kabir');
    const people = [aarav, meera, kabir];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await expect(aarav.page.getByTestId('room-lock')).toHaveText('Room lockOpen');
      // only the host has the Lock button
      await expect(meera.page.getByTestId('lock-button')).toHaveCount(0);

      await aarav.page.getByTestId('lock-button').click();
      await expect(aarav.page.getByTestId('access-notice')).toContainText('Room locked');
      await expect(aarav.page.getByTestId('lock-button')).toHaveText('Unlock');
      await expect(meera.page.getByTestId('locked-chip')).toBeVisible(); // everyone sees it at once
      await expect(meera.page.getByTestId('room-lock')).toHaveText('Room lockLocked');

      await kabir.page.goto(`/r/${code}`);
      const locked = kabir.page.getByTestId('room-locked');
      await expect(locked.getByRole('heading')).toHaveText('This room is locked');
      await expect(locked).toContainText('The host has locked "Hackathon pitch"');
      await expect(kabir.page.getByTestId('prompt-editor')).toHaveCount(0);
      expect(await axe(kabir.page)).toEqual([]);

      // someone who already has a seat reloads: still in
      await meera.page.reload();
      await expect(meera.page.getByTestId('prompt-editor')).toBeVisible();
      await expect(meera.page.getByTestId('locked-chip')).toBeVisible();

      // unlock from the room menu, then "Try again" gets Kabir in
      await openRoomMenu(aarav);
      await aarav.page.getByRole('menuitem', { name: 'Unlock room' }).click();
      await expect(meera.page.getByTestId('locked-chip')).toHaveCount(0);
      await locked.getByRole('button', { name: 'Try again' }).click();
      await expect(kabir.page.getByTestId('prompt-editor')).toBeVisible();
      await expect(aarav.page.getByTestId('people-list').getByText('Kabir')).toBeVisible();
    } finally {
      await closeAll(people);
    }
  });

  test('the host removes someone: they are sent out and cannot come back', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const kabir = await person(browser, 'Kabir');
    const people = [aarav, meera, kabir];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await joinRoom(kabir, code);
      await write(kabir, 'Kabir wrote this. ');
      await expect.poll(() => promptText(aarav)).toContain('Kabir wrote this.');
      // only the host has host actions
      await expect(meera.page.getByRole('button', { name: 'Host actions for Kabir' })).toHaveCount(
        0,
      );

      await aarav.page.getByRole('button', { name: 'Host actions for Kabir' }).click();
      await aarav.page.getByRole('menuitem', { name: 'Remove from the room…' }).click();
      await aarav.page.getByTestId('confirm-access').click();
      await expect(aarav.page.getByTestId('access-notice')).toContainText('Kabir was removed');

      const removed = kabir.page.getByTestId('room-removed');
      await expect(removed.getByRole('heading')).toHaveText('You were removed from this room');
      expect(await axe(kabir.page)).toEqual([]);
      await kabir.page.goto(`/r/${code}`);
      await expect(kabir.page.getByTestId('room-removed')).toBeVisible();
      await expect(kabir.page.getByTestId('prompt-editor')).toHaveCount(0);

      // the room goes on without them; what they wrote stays, with their name
      await expect(aarav.page.getByTestId('people-list').getByText('Kabir')).toHaveCount(0);
      await write(meera, 'Meera goes on.');
      await expect.poll(() => promptText(aarav)).toBe('Kabir wrote this. Meera goes on.');
    } finally {
      await closeAll(people);
    }
  });

  test('make host, then the new host deletes the room for everyone', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const people = [aarav, meera];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await aarav.page.getByRole('button', { name: 'Host actions for Meera' }).click();
      await aarav.page.getByRole('menuitem', { name: 'Make host' }).click();
      await expect(aarav.page.getByTestId('access-notice')).toHaveText('Meera is the host now.');
      await expect(meera.page.getByTestId('lock-button')).toBeVisible();
      await expect(aarav.page.getByTestId('lock-button')).toHaveCount(0);

      await openRoomMenu(meera);
      await meera.page.getByRole('menuitem', { name: 'Delete room for everyone…' }).click();
      await meera.page.getByTestId('confirm-access').click();
      for (const p of people) {
        await expect(p.page.getByTestId('room-deleted').getByRole('heading')).toHaveText(
          'This room was deleted',
        );
      }
      await aarav.page.goto(`/r/${code}`);
      await expect(aarav.page.getByTestId('room-not-found')).toBeVisible();
    } finally {
      await closeAll(people);
    }
  });

  test('a room opens with its content when nobody else is online', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    // Playwright's Firefox loses the requests a page sends from "pagehide" when it closes the tab
    // in about half the runs, unless some "pagehide" listener exists from the very start of the
    // document (measured: 12 of 12 with one, 4-8 of 12 without). An empty one changes nothing in
    // the app; it only lets the app's own close path be tested in Firefox.
    await aarav.context.addInitScript(() => {
      window.addEventListener('pagehide', () => undefined);
    });
    let code: string;
    try {
      code = await createRoom(aarav);
      await write(aarav, '/short Draft a 2-minute pitch');
      await aarav.page.getByTestId('send-button').click();
      await expect(aarav.page.getByTestId('turn-answer')).toHaveAttribute('data-status', 'done', {
        timeout: 15_000,
      });
      await write(aarav, 'Next prompt, not sent yet');
      // closing the tab saves what is not saved yet (closing the whole browser context skips the
      // page's "pagehide" in Chromium, so the tab is closed first, as a person would). A real
      // browser lets a closed tab's keepalive request finish; closing the test context right away
      // would cut it off (seen against the hosted project, where the request takes longer), so
      // the test waits for it - or two seconds at most - before closing the context.
      const left = aarav.context
        .waitForEvent('requestfinished', {
          predicate: (r) => r.url().includes('leave_room'),
          timeout: 2_000,
        })
        .catch(() => null);
      await aarav.page.close();
      await left;
    } finally {
      await closeAll([aarav]);
    }
    // a different device, later: no peer to sync from, the server copy opens
    const meera = await person(browser, 'Meera');
    try {
      await joinRoom(meera, code);
      await expect(meera.page.getByTestId('room-title')).toHaveText('Hackathon pitch');
      await expect(meera.page.getByTestId('turn-answer')).toHaveCount(1);
      await expect.poll(() => promptText(meera)).toBe('Next prompt, not sent yet');
      await expect(meera.page.getByTestId('people-list').getByText('Meera')).toBeVisible();
    } finally {
      await closeAll([meera]);
    }
  });

  test('a seat is freed when someone leaves: the ninth person gets in after that', async ({
    browser,
  }) => {
    const host = await person(browser, 'Host');
    const others: Person[] = [];
    const ninth = await person(browser, 'Ninth');
    try {
      const code = await createRoom(host);
      for (let i = 2; i <= 8; i++) {
        const p = await person(browser, `P${String(i)}`);
        others.push(p);
        await joinRoom(p, code);
      }
      await ninth.page.goto(`/r/${code}`);
      await expect(ninth.page.getByTestId('room-full')).toBeVisible();
      // leaving through the menu frees the seat at once; a closed tab frees it after 90 seconds
      const leaver = others[others.length - 1];
      if (leaver) {
        await leaver.page.getByRole('button', { name: 'Room menu' }).click();
        await leaver.page.getByRole('menuitem', { name: 'Leave room' }).click();
        await expect(leaver.page).not.toHaveURL(/\/r\//);
      }
      await expect(host.page.getByTestId('people-list').locator('li')).toHaveCount(7);
      await ninth.page.getByTestId('room-full').getByRole('button', { name: 'Try again' }).click();
      await expect(ninth.page.getByTestId('prompt-editor')).toBeVisible();
    } finally {
      await closeAll([host, ninth, ...others]);
    }
  });
});

test.describe('export', () => {
  test('Markdown and JSON downloads hold the conversation with its authors and context', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const people = [aarav, meera];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      // context from Meera, a prompt written by both
      await meera.page
        .getByTestId('context-panel')
        .getByRole('button', { name: 'Add note' })
        .click();
      const note = meera.page.getByRole('dialog', { name: 'Add a note' });
      await note.getByTestId('item-title').fill('Survey numbers');
      await note.getByTestId('item-text').fill('61 of 80 students');
      await note.getByTestId('item-save').click();
      await write(aarav, '/short Make it ');
      await expect.poll(() => promptText(meera)).toBe('/short Make it ');
      await write(meera, '2 minutes');
      await expect.poll(() => promptText(aarav)).toBe('/short Make it 2 minutes');
      await aarav.page.getByTestId('send-button').click();
      for (const p of people) {
        await expect(p.page.getByTestId('turn-answer')).toHaveAttribute('data-status', 'done', {
          timeout: 15_000,
        });
      }

      await openRoomMenu(meera);
      await meera.page.getByRole('menuitem', { name: 'Export' }).click();
      const dialog = meera.page.getByRole('dialog', { name: 'Export conversation' });
      await expect(dialog.getByTestId('export-branch')).toHaveValue('main');
      await expect(dialog.getByTestId('export-preview')).toContainText('## Turn 1 - sent by Aarav');
      expect(await axe(meera.page)).toEqual([]);

      const [md] = await Promise.all([
        meera.page.waitForEvent('download'),
        dialog.getByTestId('export-download').click(),
      ]);
      expect(md.suggestedFilename()).toMatch(/^hackathon-pitch-\d{4}-\d{2}-\d{2}\.md$/u);
      const markdown = await readFile(await md.path(), 'utf8');
      expect(markdown).toContain('# Hackathon pitch');
      expect(markdown).toContain(
        `Room ${code.slice(0, 3)}-${code.slice(3)} · branch main · 1 turn`,
      );
      expect(markdown).toContain('**Prompt** (Aarav, Meera)');
      expect(markdown).toContain('> /short Make it 2 minutes');
      expect(markdown).toContain('Context: Survey numbers (Meera)');
      expect(markdown).toContain('Model: Demo model');
      expect(markdown).toContain('### Survey numbers (Meera, note)');

      // JSON without names and without context
      await dialog.getByText('JSON', { exact: true }).click();
      await dialog.getByLabel('Include context items').uncheck();
      await dialog.getByLabel('Include author names').uncheck();
      const [js] = await Promise.all([
        meera.page.waitForEvent('download'),
        dialog.getByTestId('export-download').click(),
      ]);
      expect(js.suggestedFilename()).toMatch(/\.json$/u);
      const text = await readFile(await js.path(), 'utf8');
      expect(text).not.toMatch(/Aarav|Meera|Survey numbers|61 of 80/u);
      const record = JSON.parse(text) as {
        app: string;
        room: { code: string };
        authorNames: boolean;
        turns: {
          label: string;
          sentBy: string;
          status: string;
          answer: string;
          requestSha256: string;
          prompt: { text: string; segments: { text: string; author: string }[] };
        }[];
      };
      expect(record).toMatchObject({ app: 'PromptAlong', room: { code }, authorNames: false });
      expect(record.turns).toHaveLength(1);
      const turn = record.turns[0];
      expect(turn).toMatchObject({ label: 'T1', sentBy: 'Person 1', status: 'done' });
      expect(turn?.prompt.segments.map((s) => [s.text, s.author])).toEqual([
        ['/short Make it ', 'Person 1'],
        ['2 minutes', 'Person 2'],
      ]);
      expect(turn?.requestSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(turn?.answer.length).toBeGreaterThan(10);
    } finally {
      await closeAll(people);
    }
  });
});

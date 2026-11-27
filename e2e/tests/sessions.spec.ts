import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { closeAll, createRoom, editor, joinRoom, person, promptText, type Person } from './helpers';

const session = (p: Person, name: string) =>
  p.page.getByTestId('session-item').filter({ hasText: name });

async function newSession(host: Person, name: string, members: string[]): Promise<void> {
  await host.page.getByTestId('new-session').click();
  const dialog = host.page.getByRole('dialog', { name: 'New session' });
  await dialog.getByTestId('session-name').fill(name);
  for (const m of members) await dialog.getByTestId(`member-${m}`).check();
  await dialog.getByTestId('session-save').click();
  await expect(dialog).toBeHidden();
}

async function violations(page: Page) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  return res.violations.map((v) => v.id);
}

test.describe('sessions', () => {
  test('a private session: its people work in it, the rest of the room never sees it', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const kabir = await person(browser, 'Kabir');
    const people = [aarav, meera, kabir];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await joinRoom(kabir, code);
      await expect(aarav.page.getByTestId('people-list').locator('li')).toHaveCount(3);

      // the host makes "Slides" for himself and Meera; it opens for him at once
      await newSession(aarav, 'Slides', ['Meera']);
      await expect(aarav.page.getByTestId('session-title')).toHaveText(' / Slides');
      await expect(session(meera, 'Slides')).toBeVisible();
      await expect(kabir.page.getByTestId('session-item')).toHaveCount(0); // only General: no list

      // Aarav sends in Slides while Meera stays in General: she sees a badge and a tab count
      await editor(aarav).click();
      await aarav.page.keyboard.type('/short Three slide titles');
      await aarav.page.getByTestId('send-button').click();
      await expect(session(meera, 'Slides').getByTestId('session-unread')).toHaveText('2');
      await expect(meera.page).toHaveTitle(/^\(2\) Hackathon pitch/u);
      await expect.poll(() => promptText(meera)).toBe(''); // General's prompt is its own

      // she opens it: the answer is there, the badge and the count are gone
      await session(meera, 'Slides').getByRole('button').first().click();
      await expect(meera.page.getByTestId('turn-answer')).toHaveCount(1);
      await expect(session(meera, 'Slides').getByTestId('session-unread')).toHaveCount(0);
      await expect(meera.page).toHaveTitle(/^Hackathon pitch/u);
      // the people list says who is where - to people who may know the session, not to Kabir
      await expect(aarav.page.getByTestId('people-list')).toContainText('in Slides');
      await expect(kabir.page.getByTestId('people-list')).not.toContainText('Slides');

      // Meera pins the answer: Kabir (not in Slides) can read the pin, not the session
      await meera.page.getByTestId('pin-answer').click();
      await kabir.page.getByTestId('pin-item').click();
      const pin = kabir.page.getByTestId('pin-view');
      await expect(pin).toContainText('Three slide titles');
      await expect(kabir.page.getByTestId('pin-open-session')).toHaveCount(0);
      await expect(kabir.page.getByTestId('unpin')).toHaveCount(0);
      await kabir.page.keyboard.press('Escape');

      expect(await violations(aarav.page)).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });

  test('the host renames a session and takes someone out of it; then deletes it', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const people = [aarav, meera];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await newSession(aarav, 'Research', ['Meera']);
      await session(meera, 'Research').getByRole('button').first().click();
      await expect(meera.page.getByTestId('session-title')).toHaveText(' / Research');

      await session(aarav, 'Research').hover();
      await aarav.page.getByRole('button', { name: 'Session actions for Research' }).click();
      await aarav.page.getByRole('menuitem', { name: 'Rename or change people…' }).click();
      const dialog = aarav.page.getByRole('dialog', { name: 'Change Research' });
      await dialog.getByTestId('session-name').fill('Sources');
      await dialog.getByTestId('member-Meera').uncheck();
      await dialog.getByTestId('session-save').click();
      await expect(dialog).toBeHidden();

      // Meera loses it at once and is back in General
      await expect(meera.page.getByTestId('session-item')).toHaveCount(0);
      await expect(meera.page.getByTestId('session-title')).toHaveCount(0);
      await expect(session(aarav, 'Sources')).toBeVisible();

      await session(aarav, 'Sources').hover();
      await aarav.page.getByRole('button', { name: 'Session actions for Sources' }).click();
      await aarav.page.getByRole('menuitem', { name: 'Delete session…' }).click();
      await aarav.page.getByTestId('confirm-delete-session').click();
      await expect(aarav.page.getByTestId('session-item')).toHaveCount(1); // General only
    } finally {
      await closeAll(people);
    }
  });
});

test.describe('PDF export of a room with sessions', () => {
  test('one PDF for the room, a zip of one PDF per session, Hindi noticed, print view', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    try {
      await aarav.page.addInitScript(() => {
        // the print dialog is the browser's: here it only records that it was asked for
        window.print = () => {
          (window as unknown as { printed: number }).printed =
            ((window as unknown as { printed?: number }).printed ?? 0) + 1;
        };
      });
      await createRoom(aarav);
      await editor(aarav).click();
      await aarav.page.keyboard.type('/short इसे हिन्दी में लिखिए');
      await aarav.page.getByTestId('send-button').click();
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(1);
      await newSession(aarav, 'Slides', []);
      await editor(aarav).click();
      await aarav.page.keyboard.type('/short Three slide titles');
      await aarav.page.getByTestId('send-button').click();
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(1);

      await aarav.page.getByRole('button', { name: 'Room menu' }).click();
      await aarav.page.getByRole('menuitem', { name: 'Export' }).click();
      const dialog = aarav.page.getByRole('dialog', { name: 'Export conversation' });
      await dialog.getByTestId('export-range-room').check();
      await expect(dialog.getByTestId('export-hindi')).toBeVisible();
      const [one] = await Promise.all([
        aarav.page.waitForEvent('download'),
        dialog.getByTestId('export-download').click(),
      ]);
      expect(one.suggestedFilename()).toMatch(/\.pdf$/u);
      const pdf = await readFile(await one.path());
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      await dialog.getByTestId('export-range-each').check();
      await expect(dialog.getByTestId('export-download')).toHaveText('Download PDFs (.zip)');
      const [zip] = await Promise.all([
        aarav.page.waitForEvent('download'),
        dialog.getByTestId('export-download').click(),
      ]);
      expect(zip.suggestedFilename()).toMatch(/\.zip$/u);
      const z = await readFile(await zip.path());
      expect(z.subarray(0, 2).toString('latin1')).toBe('PK');
      const names = z.toString('latin1').match(/hackathon-pitch-[a-z-]+-\d{4}-\d{2}-\d{2}\.pdf/gu);
      expect(new Set(names)).toEqual(
        new Set([
          expect.stringMatching(/^hackathon-pitch-general-/u),
          expect.stringMatching(/^hackathon-pitch-slides-/u),
        ]),
      );

      // the print view: the browser's own fonts, then the print dialog
      await dialog.getByTestId('export-print').click();
      const view = aarav.page.getByTestId('print-view');
      await expect(view).toContainText('Slides');
      await expect(view).toContainText('इसे हिन्दी में लिखिए');
      await expect(view.getByTestId('print-credit')).toContainText('by Shubh and Sidak');
      await expect
        .poll(() => aarav.page.evaluate(() => (window as unknown as { printed?: number }).printed))
        .toBe(1);
    } finally {
      await closeAll([aarav]);
    }
  });
});

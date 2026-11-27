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

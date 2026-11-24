import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface Person {
  context: BrowserContext;
  page: Page;
  name: string;
}

/** A new browser context (like a separate laptop) with a display name already saved. */
export async function person(browser: Browser, name: string): Promise<Person> {
  const context = await browser.newContext();
  await context.addInitScript((n) => {
    window.localStorage.setItem('promptalong:name', n);
  }, name);
  const page = await context.newPage();
  return { context, page, name };
}

export async function closeAll(people: Person[]): Promise<void> {
  await Promise.all(people.map((p) => p.context.close()));
}

/** Creates a room from the lobby and returns its code. */
export async function createRoom(p: Person, roomName = 'Hackathon pitch'): Promise<string> {
  await p.page.goto('/new');
  await p.page.getByLabel('Room name').fill(roomName);
  await p.page.getByRole('button', { name: 'Create room' }).click();
  await p.page.waitForURL(/\/r\/[1-9A-Z]{6}$/u);
  const share = p.page.getByRole('dialog', { name: 'Invite your team' });
  await expect(share).toBeVisible(); // opens once after creating a room
  await share.getByRole('button', { name: 'Close' }).click();
  await expect(share).toBeHidden();
  await expect(p.page.getByTestId('room-title')).toHaveText(roomName);
  const code = p.page.url().split('/r/')[1];
  if (!code) throw new Error('no room code');
  return code;
}

export async function joinRoom(p: Person, code: string): Promise<void> {
  await p.page.goto(`/r/${code}`);
  await expect(p.page.getByTestId('prompt-editor')).toBeVisible();
}

export function editor(p: Person) {
  return p.page.getByTestId('prompt-editor');
}

/** The prompt text without the remote cursor name labels. */
export async function promptText(p: Person): Promise<string> {
  return editor(p).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.pa-caret').forEach((c) => {
      c.remove();
    });
    return Array.from(copy.querySelectorAll('p'))
      .map((para) => para.textContent)
      .join('\n');
  });
}

/** Puts the caret at the very end of the prompt. */
export async function focusEnd(p: Person): Promise<void> {
  await editor(p).click();
  await p.page.keyboard.press('Control+End');
}

export async function expectSameText(people: Person[], timeout = 10_000): Promise<string> {
  let last: string[] = [];
  await expect
    .poll(
      async () => {
        last = await Promise.all(people.map((p) => promptText(p)));
        return new Set(last).size;
      },
      { timeout },
    )
    .toBe(1);
  return last[0] ?? '';
}

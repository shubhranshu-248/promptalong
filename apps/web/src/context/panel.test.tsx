import {
  MemoryHub,
  addContextItem,
  assembleRoom,
  promptFragment,
  setRoomModel,
  sha256Hex,
} from '@promptalong/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type * as Y from 'yjs';
import { buildBody, sendPrompt } from '../room/send';
import { RoomSession } from '../room/session';
import { useRoomSnapshot } from '../room/useRoomSession';
import { ContextPanel, type PanelTab } from './ContextPanel';
import { useContextBudget } from './useContextBudget';

const sessions: RoomSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop();
});

function open(hub: MemoryHub, pid: string, name: string, at: number, create = false) {
  const s = new RoomSession({
    code: 'K7QM2X',
    pid,
    name,
    transport: hub.createTransport(),
    now: () => at,
    ...(create ? { create: { name: 'Hackathon pitch', sendPolicy: 'everyone' as const } } : {}),
  });
  s.start();
  sessions.push(s);
  return s;
}

function Harness({ session, start = 'context' }: { session: RoomSession; start?: PanelTab }) {
  const snap = useRoomSnapshot(session);
  const data = useContextBudget(session, snap);
  const [tab, setTab] = useState<PanelTab>(start);
  return (
    <ContextPanel
      session={session}
      snap={snap}
      data={data}
      tab={tab}
      onTab={setTab}
      onClose={() => undefined}
    />
  );
}

function type(doc: Y.Doc, text: string) {
  const node = (promptFragment(doc).get(0) as Y.XmlElement).get(0) as Y.XmlText;
  act(() => {
    node.insert(node.length, text);
  });
}

describe('context panel', () => {
  it('adds a note, shows who owns it, and another person can switch it off', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1, true);
    const b = open(hub, 'bbbb2222', 'Meera', 2);
    await waitFor(() => {
      expect(b.getSnapshot().people).toHaveLength(2);
    });
    render(<Harness session={a} />);

    expect(screen.getByTestId('context-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a note' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'App features' } });
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: '- live map of found items\n- photo + pin' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to the room' }));

    const item = await screen.findByTestId('context-item');
    expect(item).toHaveTextContent('App features');
    expect(item).toHaveTextContent('You · note · 39 B');
    expect(screen.getByTestId('context-count')).toHaveTextContent('1 of 1 included');
    await waitFor(() => {
      expect(b.getSnapshot().context).toHaveLength(1);
    });

    // Meera excludes it in her browser: Aarav's panel says who did it
    const id = b.getSnapshot().context[0]?.id ?? '';
    act(() => {
      b.doc.getMap<Y.Map<unknown>>('context').get(id)?.set('included', false);
      b.doc.getMap<Y.Map<unknown>>('context').get(id)?.set('toggledBy', 'bbbb2222');
    });
    await waitFor(() => {
      expect(screen.getByTestId('context-item')).toHaveTextContent('excluded by Meera');
    });
    expect(screen.getByRole('checkbox', { name: 'Include App features' })).not.toBeChecked();
    expect(screen.getByTestId('context-count')).toHaveTextContent('0 of 1 included');

    // and Aarav switches it back on
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include App features' }));
    await waitFor(() => {
      expect(b.getSnapshot().context[0]?.included).toBe(true);
    });
  });

  it('the Payload tab shows the string Send posts, and its hash is the turn’s request hash', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1, true);
    act(() => {
      addContextItem(a.doc, {
        id: 'c1',
        ownerUid: 'aaaa1111',
        kind: 'snippet',
        title: 'Survey numbers',
        text: '61 of 80 students lost something this sem.',
        createdAt: 5,
      });
    });
    type(a.doc, '/short Make it 2 minutes');
    render(<Harness session={a} start="payload" />);

    fireEvent.click(screen.getByTestId('payload-json-button'));
    const expected = buildBody(a.getSnapshot().model, assembleRoom(a.doc).messages);
    await waitFor(() => {
      expect(screen.getByTestId('payload-json')).toHaveTextContent(expected, {
        normalizeWhitespace: false,
      });
    });
    expect(expected).toContain('[context: Survey numbers · Aarav]\\n61 of 80 students');
    const hash = await sha256Hex(expected);
    await waitFor(() => {
      expect(screen.getByTestId('payload-hash')).toHaveAttribute('data-hash', hash);
    });
    expect(screen.getByTestId('payload-last')).toHaveTextContent('nothing sent yet');

    let sent: Awaited<ReturnType<typeof sendPrompt>> | undefined;
    await act(async () => {
      sent = await sendPrompt(a);
    });
    expect(sent?.ok).toBe(true);
    await waitFor(() => {
      expect(a.getSnapshot().turns[0]?.status).toBe('done');
    });
    const turn = a.getSnapshot().turns[0];
    expect(turn?.requestHash).toBe(hash);
    expect(turn?.context.map((c) => c.title)).toEqual(['Survey numbers']);
    await waitFor(() => {
      expect(screen.getByTestId('payload-last')).toHaveAttribute('data-hash', hash);
    });
  });

  it('the readable view names every source and never hides one', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1, true);
    act(() => {
      addContextItem(a.doc, {
        id: 'c1',
        ownerUid: 'aaaa1111',
        kind: 'note',
        title: 'App features',
        text: '- live map',
        createdAt: 5,
      });
    });
    type(a.doc, 'Three slide titles');
    render(<Harness session={a} start="payload" />);
    await waitFor(() => {
      expect(screen.getByTestId('seg-prompt')).toHaveTextContent('user (T1): Three slide titles');
    });
    expect(screen.getByTestId('seg-context')).toHaveTextContent('[context: App features · Aarav]');
    expect(screen.queryByTestId('seg-system')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add room line' }));
    fireEvent.change(screen.getByTestId('room-line-input'), { target: { value: 'Be brief.' } });
    fireEvent.click(screen.getByTestId('room-line-save'));
    await waitFor(() => {
      expect(screen.getByTestId('seg-system')).toHaveTextContent('system: Be brief.');
    });
    expect(assembleRoom(a.doc).messages[0]?.content).toBe(
      'Be brief.\n\n[context: App features · Aarav]\n- live map',
    );
  });

  it('over budget: says how much to remove and marks counts "about" for a model without a tokenizer', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1, true);
    act(() => {
      setRoomModel(a.doc, { kind: 'webllm', model: 'SmolLM2-360M-Instruct-q4f16_1-MLC' });
      addContextItem(a.doc, {
        id: 'big',
        ownerUid: 'aaaa1111',
        kind: 'file',
        title: 'everything.txt',
        text: 'word '.repeat(8000),
        createdAt: 5,
      });
    });
    render(<Harness session={a} />);
    const budget = await screen.findByTestId('budget');
    await waitFor(() => {
      expect(budget).toHaveAttribute('data-over', 'true');
    });
    expect(screen.getByTestId('budget-numbers')).toHaveTextContent(/^about [\d,]+ \/ 6,144$/u);
    expect(budget).toHaveTextContent('This does not fit. Remove about');
    expect(budget).toHaveTextContent('8,192 window, 2,048 kept for the answer');

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Include everything.txt' }));
    await waitFor(() => {
      expect(screen.getByTestId('budget')).toHaveAttribute('data-over', 'false');
    });
    expect(screen.getByTestId('item-tokens')).toHaveTextContent(/^\([\d,]+\)$/u);
  });
});

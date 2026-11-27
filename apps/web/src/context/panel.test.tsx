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
import { useRoomSnapshot, useSessionSnapshot } from '../room/useRoomSession';
import type { SessionConn } from '../room/session-conn';
import { general, sessionHubFor, sessionOpen } from '../test/sessions';
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
    sessionTransport: () => sessionHubFor(hub).createTransport(),
    prepare: create,
    now: () => at,
    ...(create ? { create: { name: 'Hackathon pitch', sendPolicy: 'everyone' as const } } : {}),
  });
  s.start();
  sessions.push(s);
  return s;
}

function Harness({ session, start = 'context' }: { session: RoomSession; start?: PanelTab }) {
  const snap = useRoomSnapshot(session);
  const conn = snap.activeId ? session.conn(snap.activeId) : null;
  return conn ? <Panel session={session} conn={conn} start={start} /> : null;
}

function Panel({
  session,
  conn,
  start,
}: {
  session: RoomSession;
  conn: SessionConn;
  start: PanelTab;
}) {
  const snap = useRoomSnapshot(session);
  const ss = useSessionSnapshot(session, conn);
  const data = useContextBudget(session, snap, conn, ss);
  const [tab, setTab] = useState<PanelTab>(start);
  return (
    <ContextPanel
      session={session}
      snap={snap}
      conn={conn}
      ss={ss}
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
    await Promise.all([sessionOpen(a), sessionOpen(b)]);
    render(<Harness session={a} />);

    expect(screen.getByTestId('context-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a note' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'App features' } });
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: '- live map of found items\n- photo + pin' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to this session' }));

    const item = await screen.findByTestId('context-item');
    expect(item).toHaveTextContent('App features');
    expect(item).toHaveTextContent('You · note · 39 B');
    expect(screen.getByTestId('context-count')).toHaveTextContent('1 of 1 included');
    await waitFor(() => {
      expect(general(b).getSnapshot().context).toHaveLength(1);
    });
    // a session's own item: not in the room's list
    expect(b.getSnapshot().context).toHaveLength(0);
    expect(screen.getByTestId('context-session')).toHaveTextContent('App features');

    // Meera excludes it in her browser: Aarav's panel says who did it
    const id = general(b).getSnapshot().context[0]?.id ?? '';
    act(() => {
      general(b).doc.getMap<Y.Map<unknown>>('context').get(id)?.set('included', false);
      general(b).doc.getMap<Y.Map<unknown>>('context').get(id)?.set('toggledBy', 'bbbb2222');
    });
    await waitFor(() => {
      expect(screen.getByTestId('context-item')).toHaveTextContent('excluded by Meera');
    });
    expect(screen.getByRole('checkbox', { name: 'Include App features' })).not.toBeChecked();
    expect(screen.getByTestId('context-count')).toHaveTextContent('0 of 1 included');

    // and Aarav switches it back on
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include App features' }));
    await waitFor(() => {
      expect(general(b).getSnapshot().context[0]?.included).toBe(true);
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
    const sa = await sessionOpen(a);
    type(sa.doc, '/short Make it 2 minutes');
    render(<Harness session={a} start="payload" />);

    fireEvent.click(await screen.findByTestId('payload-json-button'));
    const expected = buildBody(
      sa.getSnapshot().model,
      assembleRoom(sa.doc, { room: a.doc }).messages,
    );
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
      sent = await sendPrompt(sa);
    });
    expect(sent?.ok).toBe(true);
    await waitFor(() => {
      expect(sa.getSnapshot().turns[0]?.status).toBe('done');
    });
    const turn = sa.getSnapshot().turns[0];
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
    const s3 = await sessionOpen(a);
    type(s3.doc, 'Three slide titles');
    render(<Harness session={a} start="payload" />);
    await waitFor(() => {
      expect(screen.getByTestId('seg-prompt')).toHaveTextContent('user (T1): Three slide titles');
    });
    expect(screen.getByTestId('seg-context')).toHaveTextContent('[context: App features · Aarav]');
    expect(screen.queryByTestId('seg-system')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add room instructions' }));
    fireEvent.change(screen.getByTestId('room-line-input'), { target: { value: 'Be brief.' } });
    fireEvent.click(screen.getByTestId('room-line-save'));
    await waitFor(() => {
      expect(screen.getByTestId('seg-system')).toHaveTextContent('system: Be brief.');
    });
    // the session's own instructions come after the room's
    fireEvent.click(screen.getByRole('button', { name: 'Add session instructions' }));
    fireEvent.change(screen.getByTestId('session-line-input'), {
      target: { value: 'Answer as slides.' },
    });
    const saves = screen.getAllByTestId('room-line-save');
    fireEvent.click(saves[saves.length - 1] ?? saves[0] ?? document.body);
    await waitFor(() => {
      expect(screen.getByTestId('seg-system')).toHaveTextContent(
        'system: Be brief. Answer as slides.',
      );
    });
    expect(assembleRoom(s3.doc, { room: a.doc }).messages[0]?.content).toBe(
      'Be brief.\n\nAnswer as slides.\n\n[context: App features · Aarav]\n- live map',
    );
    // the room's document keeps only the room's line
    expect(assembleRoom(a.doc).messages[0]?.content).toContain('Be brief.');
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
    await sessionOpen(a);
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

import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { YjsCollaboration } from './yjs-collaboration';

/** Two people's editors on two documents that exchange every update at once. */
function pair(initial: string) {
  const docs = [new Y.Doc(), new Y.Doc()] as const;
  const [first, second] = docs;
  first.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(second, update, 'remote');
  });
  second.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(first, update, 'remote');
  });
  const seed = first.getXmlFragment('prompt');
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(initial)]);
  seed.insert(0, [p]);
  const editors = docs.map(
    (doc) =>
      new Editor({
        element: document.createElement('div'),
        extensions: [
          Document,
          Paragraph,
          Text,
          YjsCollaboration.configure({
            fragment: doc.getXmlFragment('prompt'),
            awareness: new Awareness(doc),
          }),
        ],
      }),
  );
  return { docs, editors };
}

const text = (e: Editor) => e.state.doc.textContent;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('two people typing at the same spot', () => {
  it('each person keeps their own letters together (no interleaving)', async () => {
    const { editors } = pair('Write a 9');
    const [a, b] = editors as [Editor, Editor];
    // the binding renders the shared content after the views are ready
    await new Promise((r) => setTimeout(r, 0));
    for (const e of editors) e.commands.setTextSelection(e.state.doc.content.size - 1);
    const mine = '0-second';
    const theirs = ' (from me)';
    for (let i = 0; i < Math.max(mine.length, theirs.length); i++) {
      const m = mine.charAt(i);
      const t = theirs.charAt(i);
      if (m) a.commands.insertContent(m);
      if (t) b.commands.insertContent(t);
    }
    const result = text(a);
    expect(text(b)).toBe(result);
    expect([`Write a 9${mine}${theirs}`, `Write a 9${theirs}${mine}`]).toContain(result);
    for (const e of editors) e.destroy();
  });

  it('a remote insert in the middle does not move my caret past it', async () => {
    const { editors } = pair('abcdef');
    const [a, b] = editors as [Editor, Editor];
    await new Promise((r) => setTimeout(r, 0));
    a.commands.setTextSelection(4); // after "abc"
    b.commands.setTextSelection(4);
    b.commands.insertContent('XYZ');
    a.commands.insertContent('1');
    expect(text(a)).toBe(text(b));
    expect(text(a)).toMatch(/^abc(1XYZ|XYZ1)def$/u);
    expect(text(a)).not.toMatch(/X1|Y1|1Y|1Z(?!d)/u);
    for (const e of editors) e.destroy();
  });
});

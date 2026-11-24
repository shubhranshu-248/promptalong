import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { memo, useMemo } from 'react';
import { promptFragment } from '@promptalong/core';
import { presenceHex } from '@promptalong/ui';
import { readUser, type RoomSession } from './session';
import { YjsCollaboration, isRemoteChange } from './yjs-collaboration';

/** A remote person's caret: a line in their colour with their name (colour is never the only cue). */
function renderCaret(raw: Record<string, unknown>): HTMLElement {
  // Awareness comes from the network: colours come from the slot, never from the sender's string.
  const user = readUser(raw);
  const { color, label } = presenceHex(user?.slot ?? 1);
  const name = user?.name ?? '';
  const caret = document.createElement('span');
  caret.className = 'pa-caret';
  caret.contentEditable = 'false'; // the browser must never type into another person's caret
  caret.style.borderColor = color;
  caret.setAttribute('data-name', name);
  const tag = document.createElement('span');
  tag.className = 'pa-caret__label';
  tag.contentEditable = 'false';
  tag.style.backgroundColor = color;
  tag.style.color = label;
  tag.setAttribute('data-name', name); // drawn by CSS, so the name is not text inside the prompt
  tag.setAttribute('aria-hidden', 'true');
  caret.append(tag);
  return caret;
}

function renderSelection(raw: Record<string, unknown>) {
  const { color } = presenceHex(readUser(raw)?.slot ?? 1);
  return {
    class: 'pa-selection',
    style: `background-color: color-mix(in srgb, ${color} 22%, transparent)`,
  };
}

/**
 * Re-rendering this component calls TipTap's setOptions, which must never happen while ProseMirror
 * is handling a keystroke. So it is memoised (re-renders only when the session changes) and
 * reports activity outside the editor transaction. Carets read each person's awareness directly.
 */
export const PromptEditor = memo(function PromptEditor({ session }: { session: RoomSession }) {
  const options = useMemo(() => {
    const report = (activity: 'typing' | 'selecting' | 'idle') => {
      setTimeout(() => {
        session.setActivity(activity);
      }, 0);
    };
    return {
      extensions: [
        Document,
        Paragraph,
        Text,
        HardBreak,
        Placeholder.configure({ placeholder: 'Write the prompt together…' }),
        YjsCollaboration.configure({
          fragment: promptFragment(session.doc),
          awareness: session.awareness,
          renderCaret,
          renderSelection,
        }),
      ],
      editorProps: {
        attributes: {
          class: 'pa-editor',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Shared prompt',
          'data-testid': 'prompt-editor',
          spellcheck: 'true',
        },
      },
      onUpdate: ({ transaction }: { transaction: Parameters<typeof isRemoteChange>[0] }) => {
        if (transaction.docChanged && !isRemoteChange(transaction)) report('typing');
      },
      onSelectionUpdate: ({
        editor: e,
      }: {
        editor: { state: { selection: { empty: boolean } } };
      }) => {
        report(e.state.selection.empty ? 'idle' : 'selecting');
      },
      onBlur: () => {
        report('idle');
      },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    };
  }, [session]);

  const editor = useEditor(options, [session]);

  return <EditorContent editor={editor} />;
});

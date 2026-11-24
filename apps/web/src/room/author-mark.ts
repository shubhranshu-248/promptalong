import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { isRemoteChange } from './yjs-collaboration';

/**
 * Prompt provenance in the editor (U2, ADR-004): text the LOCAL person types or pastes gets an
 * `author {uid}` mark. Remote text arrives already marked through Yjs; undo / redo restore the
 * original marks through Yjs too, so only this person's own new text is ever (re)marked.
 */
const authorKey = new PluginKey('pa-author');

export interface AuthorMarkOptions {
  uid: string;
}

/** Inserted ranges of local transactions, in the final document's positions. */
function insertedRanges(transactions: readonly Transaction[]): [number, number][] {
  const ranges: [number, number][] = [];
  transactions.forEach((tr, t) => {
    if (!tr.docChanged || isRemoteChange(tr) || tr.getMeta(authorKey)) return;
    tr.mapping.maps.forEach((map, i) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        if (newEnd <= newStart) return;
        let from = tr.mapping.slice(i + 1).map(newStart, 1);
        let to = tr.mapping.slice(i + 1).map(newEnd, -1);
        for (const later of transactions.slice(t + 1)) {
          from = later.mapping.map(from, 1);
          to = later.mapping.map(to, -1);
        }
        if (to > from) ranges.push([from, to]);
      });
    });
  });
  return ranges;
}

export const AuthorMark = Mark.create<AuthorMarkOptions>({
  name: 'author',
  inclusive: false,
  // a span written by one person: overlapping authors are not a thing
  excludes: 'author',

  addOptions() {
    return { uid: '' };
  },

  addAttributes() {
    return {
      uid: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-author') ?? '',
        renderHTML: (attrs) => ({ 'data-author': String(attrs.uid ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-author]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'pa-author' }), 0];
  },

  addProseMirrorPlugins() {
    const uid = this.options.uid;
    const type = this.type;
    return [
      new Plugin({
        key: authorKey,
        appendTransaction: (transactions, _old, state) => {
          if (!uid) return null;
          const ranges = insertedRanges(transactions);
          if (ranges.length === 0) return null;
          const tr = state.tr;
          const mark = type.create({ uid });
          for (const [from, to] of ranges) {
            const end = Math.min(to, state.doc.content.size);
            if (end > from) tr.addMark(from, end, mark);
          }
          if (!tr.docChanged) return null;
          tr.setMeta(authorKey, true);
          // Not addToHistory=false: the mark reaches Yjs in the same change as the typed text, and
          // the undo manager skips such changes - the keystroke itself would become un-undoable.
          return tr;
        },
      }),
    ];
  },
});

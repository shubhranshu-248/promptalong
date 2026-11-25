import { Extension } from '@tiptap/core';
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { DecorationAttrs } from '@tiptap/pm/view';
import {
  absolutePositionToRelativePosition,
  defaultDeleteFilter,
  redo,
  undo,
  yCursorPlugin,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin,
} from 'y-prosemirror';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

export interface YjsCollaborationOptions {
  fragment: Y.XmlFragment | null;
  awareness: Awareness | null;
  renderCaret: (user: Record<string, unknown>) => HTMLElement;
  renderSelection: (user: Record<string, unknown>) => DecorationAttrs;
}

/** True for transactions that came from another person (applied from the shared document). */
export function isRemoteChange(tr: Transaction): boolean {
  const meta = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
  return meta?.isChangeOrigin === true;
}

/** The part of y-prosemirror's binding this file uses (it is not in the package's types). */
interface SyncBinding {
  type: Y.XmlFragment;
  doc: Y.Doc;
  mapping: Parameters<typeof absolutePositionToRelativePosition>[2];
  prosemirrorView: unknown;
  beforeTransactionSelection: unknown;
}

/**
 * My caret, as a position that stays right after the letter before it. y-prosemirror stores the
 * caret attached to the letter AFTER it, so when someone else types exactly where my caret is,
 * my caret jumps past their letters; we then both keep typing after each other's newest letter
 * and the words interleave ("9 (from0-s me)econd"). Attached to the letter before it, my caret
 * stays put, my next letter follows my own last one, and each person's words stay together.
 * Returns null for a range (left to y-prosemirror).
 */
function stickyCaret(binding: SyncBinding, state: EditorState) {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return null;
  // y-prosemirror's helpers are typed loosely (`any`)
  const rel = absolutePositionToRelativePosition(
    sel.head,
    binding.type,
    binding.mapping,
  ) as Y.RelativePosition | null;
  if (!rel) return null;
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, binding.doc);
  if (!abs || !(abs.type instanceof Y.XmlText) || abs.index === 0) return null;
  const left = Y.createRelativePositionFromTypeIndex(abs.type, abs.index, -1);
  return { type: 'text', anchor: left, head: left };
}

/** Replaces y-prosemirror's stored caret at the start of every change with the sticky one. */
function stickyCaretPlugin(): Plugin {
  return new Plugin({
    view(view) {
      const binding = (ySyncPluginKey.getState(view.state) as { binding?: SyncBinding } | undefined)
        ?.binding;
      if (!binding) return {};
      const doc = binding.doc;
      const onBefore = () => {
        if (binding.prosemirrorView == null) return;
        const caret = stickyCaret(binding, view.state);
        if (caret) binding.beforeTransactionSelection = caret;
      };
      doc.on('beforeAllTransactions', onBefore);
      return {
        destroy() {
          doc.off('beforeAllTransactions', onBefore);
        },
      };
    },
  });
}

/**
 * Binds the editor to a Yjs fragment with upstream y-prosemirror: shared content, remote carets
 * from awareness, and undo that only reverts this person's own changes.
 */
type OwnedUndoManager = Y.UndoManager & { realDestroy: () => void };

interface YjsCollaborationStorage {
  undoManager: OwnedUndoManager | null;
}

export const YjsCollaboration = Extension.create<YjsCollaborationOptions, YjsCollaborationStorage>({
  name: 'yjsCollaboration',
  priority: 1000,

  addOptions() {
    return {
      fragment: null,
      awareness: null,
      renderCaret: () => document.createElement('span'),
      renderSelection: () => ({}),
    };
  },

  addStorage() {
    return { undoManager: null };
  },

  addProseMirrorPlugins() {
    const { fragment, awareness, renderCaret, renderSelection } = this.options;
    if (!fragment || !awareness) throw new Error('YjsCollaboration needs a fragment and awareness');
    // Undo tracks only this person's edits. TipTap moves the view onto its element after creating
    // it, which destroys plugin views; y-prosemirror would destroy its undo manager with the first
    // view while the editor state keeps using it. So the manager is owned here and destroyed with
    // the editor (onDestroy).
    const undoManager = new Y.UndoManager(fragment, {
      trackedOrigins: new Set([ySyncPluginKey]),
      deleteFilter: (item) => defaultDeleteFilter(item, new Set(['paragraph'])),
      captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
    });
    const realDestroy = undoManager.destroy.bind(undoManager);
    undoManager.destroy = () => undefined;
    this.storage.undoManager = Object.assign(undoManager, { realDestroy });
    // y-prosemirror's type declarations return `any` for its plugins.
    const plugins = [
      ySyncPlugin(fragment) as Plugin,
      yCursorPlugin(awareness, {
        cursorBuilder: (user: Record<string, unknown>) => renderCaret(user),
        selectionBuilder: (user: Record<string, unknown>) => renderSelection(user),
      }) as Plugin,
      yUndoPlugin({ undoManager }) as Plugin,
      stickyCaretPlugin(),
    ];
    return plugins;
  },

  onDestroy() {
    this.storage.undoManager?.realDestroy();
    this.storage.undoManager = null;
  },

  addKeyboardShortcuts() {
    return {
      'Mod-z': () => undo(this.editor.state),
      'Mod-y': () => redo(this.editor.state),
      'Shift-Mod-z': () => redo(this.editor.state),
    };
  },
});

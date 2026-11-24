import { Extension } from '@tiptap/core';
import type { Plugin, Transaction } from '@tiptap/pm/state';
import type { DecorationAttrs } from '@tiptap/pm/view';
import {
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

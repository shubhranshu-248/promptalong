import * as Dialog from '@radix-ui/react-dialog';
import {
  CONTEXT_MAX_BYTES,
  CONTEXT_TITLE_MAX,
  SYSTEM_LINE_MAX,
  contextText,
  utf8Bytes,
  type ContextItemView,
  type ContextKind,
} from '@promptalong/core';
import { Button, cx } from '@promptalong/ui';
import { useId, useState } from 'react';
import type * as Y from 'yjs';
import { DialogShell } from '../room/dialogs';
import { formatBytes } from './files';

const field =
  'h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-[15px] text-text';
const area =
  'min-h-[200px] w-full resize-y rounded-md border border-border-strong bg-surface p-3 text-sm text-text';
const label = 'mb-1.5 block text-sm font-semibold';

export type ItemDialogMode =
  | { type: 'add'; kind: Exclude<ContextKind, 'file'> }
  | { type: 'edit'; item: ContextItemView }
  | { type: 'view'; item: ContextItemView };

function ItemForm({
  mode,
  initialTitle,
  initialText,
  onClose,
  onSubmit,
}: {
  mode: ItemDialogMode;
  initialTitle: string;
  initialText: string;
  onClose: () => void;
  onSubmit: (title: string, text: string) => string | null;
}) {
  const ids = { title: useId(), text: useId() };
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [problem, setProblem] = useState<string | null>(null);
  const readOnly = mode.type === 'view';
  const snippet = mode.type === 'add' ? mode.kind === 'snippet' : mode.item.kind !== 'note';
  const bytes = utf8Bytes(text);
  const tooLarge = bytes > CONTEXT_MAX_BYTES;
  const fallback = mode.type === 'add' ? (mode.kind === 'note' ? 'Note' : 'Snippet') : 'Untitled';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (readOnly) {
          onClose();
          return;
        }
        const failed = onSubmit(title.trim() || fallback, text);
        setProblem(failed);
        if (!failed) onClose();
      }}
    >
      <label className={label} htmlFor={ids.title}>
        Title
      </label>
      <input
        id={ids.title}
        className={field}
        value={title}
        maxLength={CONTEXT_TITLE_MAX}
        readOnly={readOnly}
        placeholder={
          mode.type === 'add' && mode.kind === 'note' ? 'App features' : 'Survey numbers'
        }
        autoComplete="off"
        onChange={(e) => {
          setTitle(e.target.value);
        }}
        data-testid="item-title"
      />
      <label className={cx(label, 'mt-3.5')} htmlFor={ids.text}>
        {snippet ? 'Text' : 'Note'}
      </label>
      <textarea
        id={ids.text}
        className={cx(area, snippet && 'font-mono text-xs leading-relaxed')}
        value={text}
        readOnly={readOnly}
        spellCheck={!snippet}
        placeholder={snippet ? 'Paste the text here' : 'Write what the model should know'}
        onChange={(e) => {
          setText(e.target.value);
        }}
        data-testid="item-text"
      />
      <p className={cx('mt-1.5 text-xs', tooLarge ? 'text-danger' : 'text-text-muted')}>
        {formatBytes(bytes)} of 1 MB
        {readOnly ? ' · only the person who added it can change it' : ''}
      </p>
      {problem ? (
        <p className="mt-1.5 text-xs text-danger" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2.5">
        {readOnly ? (
          <Button type="submit" variant="primary">
            Close
          </Button>
        ) : (
          <>
            <Dialog.Close asChild>
              <Button>Cancel</Button>
            </Dialog.Close>
            <Button
              type="submit"
              variant="primary"
              disabled={tooLarge || text.trim().length === 0}
              data-testid="item-save"
            >
              {mode.type === 'add' ? 'Add to the room' : 'Save'}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

/** Add a note or snippet, or view / edit an item. */
export function ItemDialog({
  mode,
  doc,
  onClose,
  onAdd,
  onSave,
}: {
  mode: ItemDialogMode | null;
  doc: Y.Doc;
  onClose: () => void;
  onAdd: (kind: ContextKind, title: string, text: string) => string | null;
  onSave: (id: string, title: string, text: string) => string | null;
}) {
  const title =
    mode === null
      ? ''
      : mode.type === 'add'
        ? mode.kind === 'note'
          ? 'Add a note'
          : 'Paste a snippet'
        : mode.type === 'edit'
          ? 'Edit context'
          : mode.item.title;
  return (
    <DialogShell
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={
        mode?.type === 'add'
          ? 'Everyone in the room can read it and switch it off. It is sent to the model before the prompt.'
          : 'Sent to the model before the prompt while it is included.'
      }
      wide
    >
      {mode ? (
        <ItemForm
          key={mode.type === 'add' ? `add-${mode.kind}` : mode.item.id}
          mode={mode}
          initialTitle={mode.type === 'add' ? '' : mode.item.title}
          initialText={mode.type === 'add' ? '' : (contextText(doc, mode.item.id) ?? '')}
          onClose={onClose}
          onSubmit={(t, text) =>
            mode.type === 'add' ? onAdd(mode.kind, t, text) : onSave(mode.item.id, t, text)
          }
        />
      ) : null}
    </DialogShell>
  );
}

export function RemoveItemDialog({
  item,
  onClose,
  onRemove,
}: {
  item: ContextItemView | null;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <DialogShell
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Remove this context?"
      footer={
        <>
          <Dialog.Close asChild>
            <Button>Keep it</Button>
          </Dialog.Close>
          <Button
            variant="primary"
            onClick={() => {
              if (item) onRemove(item.id);
              onClose();
            }}
            data-testid="item-remove-confirm"
          >
            Remove for everyone
          </Button>
        </>
      }
    >
      <p className="text-sm">
        <b>{item?.title}</b> is removed from the room for everyone. Turns that were already sent
        keep the record of what they used. To leave it out of the next request only, untick it
        instead.
      </p>
    </DialogShell>
  );
}

/** The optional system line: visible to everyone, sent first. */
export function SystemLineDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string;
  onSave: (line: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(current);
  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(current);
        onOpenChange(o);
      }}
      title="Room line"
      description="One instruction for the model, sent before everything else. Everyone in the room sees it and can change it. Leave it empty to send none."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
          onOpenChange(false);
        }}
      >
        <label className={label} htmlFor={id}>
          Room line
        </label>
        <textarea
          id={id}
          className={cx(area, 'min-h-[110px]')}
          value={value}
          maxLength={SYSTEM_LINE_MAX}
          placeholder="You are helping a team prepare a hackathon pitch."
          onChange={(e) => {
            setValue(e.target.value);
          }}
          data-testid="room-line-input"
        />
        <div className="mt-5 flex justify-end gap-2.5">
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
          <Button type="submit" variant="primary" data-testid="room-line-save">
            Save
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

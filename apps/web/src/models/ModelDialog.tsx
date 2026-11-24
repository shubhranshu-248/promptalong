import * as Dialog from '@radix-ui/react-dialog';
import {
  ENDPOINTS,
  MOCK_MODELS,
  OLLAMA_SUGGESTED_MODEL,
  WEBLLM_MODELS,
  findEndpoint,
  ollamaOriginsHint,
  type ModelInfo,
  type ProviderKind,
  type RoomModelChoice,
} from '@promptalong/providers';
import { Button, cx } from '@promptalong/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { keyStore } from '../keys/key-store';
import { useKeyStore } from '../keys/useKeyStore';
import { DialogShell } from '../room/dialogs';
import { ollamaProvider, webLlmProvider } from './providers';
import { cancelWebLlm, startWebLlm, useWebLlmState } from './webllm-state';

const field =
  'h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-[15px] text-text';
const label = 'mb-1.5 block text-sm font-semibold';

function Option({
  value,
  checked,
  title,
  badge,
  badgeTone = 'neutral',
  desc,
  disabled,
  onSelect,
  children,
}: {
  value: ProviderKind;
  checked: boolean;
  title: string;
  badge?: ReactNode;
  badgeTone?: 'neutral' | 'accent' | 'ok' | 'bad';
  desc: string;
  disabled?: boolean;
  onSelect: (v: ProviderKind) => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={cx(
        'rounded-lg border p-4',
        checked ? 'border-2 border-accent p-[15px]' : 'border-border-strong',
        disabled && 'border-dashed bg-surface-2',
      )}
      data-testid={`model-option-${value}`}
    >
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="radio"
          name="model-kind"
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => {
            onSelect(value);
          }}
          className="mt-1 size-[18px] accent-[var(--c-accent)]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-[15px]">{title}</b>
            {badge ? (
              <span
                className={cx(
                  'inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-xs font-semibold',
                  badgeTone === 'accent' && 'bg-accent-soft text-accent',
                  badgeTone === 'neutral' && 'bg-surface-2',
                  badgeTone === 'ok' && 'bg-surface-2',
                  badgeTone === 'bad' && 'bg-surface-2',
                )}
              >
                {badgeTone === 'ok' || badgeTone === 'bad' ? (
                  <span
                    aria-hidden="true"
                    className={cx(
                      'size-2 rounded-full',
                      badgeTone === 'ok' ? 'bg-success' : 'bg-danger',
                    )}
                  />
                ) : null}
                {badge}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-sm text-text-muted">{desc}</span>
        </span>
      </label>
      {checked && children ? <div className="mt-4 pl-[30px] max-md:pl-0">{children}</div> : null}
    </div>
  );
}

function ModelSelect({
  id,
  models,
  value,
  onChange,
}: {
  id: string;
  models: readonly ModelInfo[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      id={id}
      className={field}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

export function KeyNote({ endpointLabel, owner }: { endpointLabel: string; owner: string }) {
  return (
    <p className="mt-3 rounded-md bg-accent-soft px-3.5 py-3 text-sm leading-relaxed">
      <b>Your key is yours.</b> It is stored only in this browser, sent only to {endpointLabel} when
      you press Send, and never shared with the room, our server, logs or analytics. Other people in
      the room see "{owner}'s key" - never the key itself.
    </p>
  );
}

interface OllamaStatus {
  state: 'checking' | 'found' | 'missing';
  models: ModelInfo[];
}

interface ModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: RoomModelChoice;
  myName: string;
  onUse: (choice: RoomModelChoice) => void;
  /** open with this option selected (e.g. "download the in-browser model first") */
  focus?: ProviderKind;
}

/** Mounted only while open, so every opening starts from the room's current choice. */
export function ModelDialog(props: ModelDialogProps) {
  return props.open ? <OpenModelDialog {...props} /> : null;
}

function OpenModelDialog({ open, onOpenChange, current, myName, onUse, focus }: ModelDialogProps) {
  const ids = {
    endpoint: useId(),
    model: useId(),
    key: useId(),
    forget: useId(),
    wl: useId(),
    ol: useId(),
  };
  const keys = useKeyStore();
  const wl = useWebLlmState();
  const [kind, setKind] = useState<ProviderKind>(focus ?? current.kind);
  const [endpoint, setEndpoint] = useState(current.endpoint ?? ENDPOINTS[0]?.id ?? 'openrouter');
  const [byokModel, setByokModel] = useState(current.kind === 'byok' ? current.model : '');
  const [keyInput, setKeyInput] = useState('');
  const [forget, setForget] = useState(() =>
    current.endpoint
      ? keyStore.has(current.endpoint) && !keyStore.isRemembered(current.endpoint)
      : false,
  );
  const [webModel, setWebModel] = useState(
    current.kind === 'webllm' ? current.model : (WEBLLM_MODELS[0]?.id ?? ''),
  );
  const [webGpu, setWebGpu] = useState<boolean | null>(null);
  const [cached, setCached] = useState<boolean>(false);
  const [ollama, setOllama] = useState<OllamaStatus>({ state: 'checking', models: [] });
  const [ollamaModel, setOllamaModel] = useState(current.kind === 'ollama' ? current.model : '');
  const [error, setError] = useState<string | null>(null);

  const ep = findEndpoint(endpoint) ?? ENDPOINTS[0];

  useEffect(() => {
    if (!open) return;
    let live = true;
    void webLlmProvider.available().then((a) => {
      if (live) setWebGpu(a.ok);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // Loads the engine library, so only when someone picks "In your browser".
  useEffect(() => {
    if (!open || !webGpu || kind !== 'webllm') return;
    let live = true;
    void webLlmProvider.isCached(webModel).then((c) => {
      if (live) setCached(c);
    });
    return () => {
      live = false;
    };
  }, [open, webGpu, webModel, kind]);

  const detectOllama = () => {
    void ollamaProvider.listModels().then(
      (models) => {
        if (models.length > 0) {
          setOllama({ state: 'found', models });
          setOllamaModel((m) => (m && models.some((x) => x.id === m) ? m : (models[0]?.id ?? '')));
        } else {
          void ollamaProvider.available().then((a) => {
            setOllama({ state: a.ok ? 'found' : 'missing', models: [] });
          });
        }
      },
      () => {
        setOllama({ state: 'missing', models: [] });
      },
    );
  };
  const checkOllama = () => {
    setOllama({ state: 'checking', models: [] });
    detectOllama();
  };
  useEffect(detectOllama, []);

  const byokModels = ep?.models ?? [];
  const effectiveByokModel =
    byokModel && byokModels.some((m) => m.id === byokModel) ? byokModel : (byokModels[0]?.id ?? '');
  const hasKey = keys.has(endpoint);

  const use = async () => {
    setError(null);
    switch (kind) {
      case 'mock':
        onUse({ kind: 'mock', model: MOCK_MODELS[0]?.id ?? 'mock-pitch-coach' });
        break;
      case 'byok': {
        if (keyInput.trim()) {
          await keyStore.set(endpoint, keyInput, !forget);
          setKeyInput('');
        } else if (!hasKey) {
          setError(`Paste your ${ep?.label ?? ''} key first.`);
          return;
        } else if (keys.remembered(endpoint) === forget) {
          // the checkbox changed: move the key between "remembered" and "this tab only"
          const k = await keyStore.get(endpoint);
          if (k) await keyStore.set(endpoint, k, !forget);
        }
        onUse({ kind: 'byok', endpoint, model: effectiveByokModel });
        break;
      }
      case 'webllm':
        if (!webGpu) return;
        onUse({ kind: 'webllm', model: webModel });
        break;
      case 'ollama':
        if (!ollamaModel) {
          setError('Ollama needs at least one model. Pull one, then press Check again.');
          return;
        }
        onUse({ kind: 'ollama', model: ollamaModel });
        break;
    }
    onOpenChange(false);
  };

  const origin = window.location.origin;
  const downloading = wl.status === 'downloading' && wl.model === webModel;
  const ready = wl.status === 'ready' && wl.model === webModel;
  const size = WEBLLM_MODELS.find((m) => m.id === webModel)?.sizeMb;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Model for this room"
      description="Everyone sees the same answer. Only the person who presses Send needs access to the model."
      footer={
        <>
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
          <Button
            variant="primary"
            onClick={() => {
              void use();
            }}
            disabled={kind === 'webllm' && !webGpu}
          >
            Use for this room
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" role="radiogroup" aria-label="Model">
        <Option
          value="mock"
          checked={kind === 'mock'}
          onSelect={setKind}
          title="Demo model"
          badge="default"
          desc="Scripted answers. No key, no download, works offline. Best for trying things out."
        />

        <Option
          value="byok"
          checked={kind === 'byok'}
          onSelect={setKind}
          title="Your own key"
          badge="stays in this browser"
          badgeTone="accent"
          desc="Any OpenAI-compatible endpoint, including free tiers (OpenRouter, Groq, Google AI Studio)."
        >
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <div>
              <label className={label} htmlFor={ids.endpoint}>
                Provider
              </label>
              <select
                id={ids.endpoint}
                className={field}
                value={endpoint}
                onChange={(e) => {
                  setEndpoint(e.target.value);
                  setByokModel('');
                  setKeyInput('');
                }}
              >
                {ENDPOINTS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor={ids.model}>
                Model
              </label>
              <ModelSelect
                id={ids.model}
                models={byokModels}
                value={effectiveByokModel}
                onChange={setByokModel}
              />
            </div>
          </div>
          <label className={cx(label, 'mt-3.5')} htmlFor={ids.key}>
            API key
          </label>
          <div className="relative">
            <input
              id={ids.key}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyInput}
              placeholder={
                hasKey ? '•••••••••••••••••••• (saved)' : `Paste your ${ep?.label ?? ''} key`
              }
              onChange={(e) => {
                setKeyInput(e.target.value);
              }}
              className={cx(field, 'pr-[150px] font-mono')}
              data-testid="key-input"
            />
            {hasKey && !keyInput ? (
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-text-muted">
                {keys.remembered(endpoint) ? 'Saved on this device' : 'Only for this tab'}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            No key yet?{' '}
            <a className="underline" href={ep?.keysUrl} target="_blank" rel="noreferrer noopener">
              Create one at {ep?.label}
            </a>
            {hasKey ? (
              <>
                {' · '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    void keyStore.forget(endpoint);
                  }}
                >
                  Remove the saved key
                </button>
              </>
            ) : null}
          </p>
          <KeyNote endpointLabel={ep?.label ?? 'the provider'} owner={myName} />
          <label className="mt-3 flex items-center gap-2.5 text-sm" htmlFor={ids.forget}>
            <input
              id={ids.forget}
              type="checkbox"
              checked={forget}
              onChange={(e) => {
                setForget(e.target.checked);
              }}
              className="size-4 accent-[var(--c-accent)]"
            />
            Forget the key when I close this tab
          </label>
        </Option>

        <Option
          value="webllm"
          checked={kind === 'webllm'}
          onSelect={setKind}
          disabled={webGpu === false}
          title="In your browser"
          badge={webGpu === false ? 'not available' : 'WebGPU'}
          badgeTone={webGpu === false ? 'neutral' : 'accent'}
          desc={
            webGpu === false
              ? 'This browser does not support WebGPU, which the in-browser model needs. Try a recent Chrome or Edge on a computer, or pick another option.'
              : 'Downloads a small open model once and runs it on your device. Nothing leaves your computer.'
          }
        >
          <label className={label} htmlFor={ids.wl}>
            Model
          </label>
          <ModelSelect id={ids.wl} models={WEBLLM_MODELS} value={webModel} onChange={setWebModel} />
          {downloading ? (
            <div className="mt-3.5" data-testid="webllm-progress">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  Downloading model · {Math.round(wl.progress * 100)}%
                </span>
                <Button size="sm" onClick={cancelWebLlm}>
                  Stop download
                </Button>
              </div>
              <div
                className="pa-progress"
                role="progressbar"
                aria-label="Model download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(wl.progress * 100)}
              >
                <i style={{ width: `${String(Math.round(wl.progress * 100))}%` }} />
              </div>
              <p className="mt-1.5 truncate text-xs text-text-muted">{wl.text}</p>
            </div>
          ) : (
            <div className="mt-3.5 flex flex-wrap items-center gap-3 text-sm">
              {ready ? (
                <span className="font-semibold">Ready - starts at once.</span>
              ) : (
                <Button
                  size="sm"
                  disabled={!webGpu}
                  onClick={() => {
                    startWebLlm(webModel);
                  }}
                >
                  {cached ? 'Start model' : 'Download model'}
                </Button>
              )}
              <span className="text-xs text-text-muted">
                {cached
                  ? 'Saved in this browser - next time it starts at once.'
                  : size
                    ? `Needs about ${size.toLocaleString()} MB of GPU memory.`
                    : ''}
              </span>
            </div>
          )}
          {wl.status === 'error' && wl.model === webModel ? (
            <p className="mt-2 text-sm text-danger" role="alert">
              {wl.error}
            </p>
          ) : null}
        </Option>

        <Option
          value="ollama"
          checked={kind === 'ollama'}
          onSelect={setKind}
          title="Ollama on this computer"
          badge={
            ollama.state === 'checking'
              ? 'checking localhost:11434…'
              : ollama.state === 'found'
                ? 'found at localhost:11434'
                : 'not found at localhost:11434'
          }
          badgeTone={
            ollama.state === 'found' ? 'ok' : ollama.state === 'missing' ? 'bad' : 'neutral'
          }
          desc="Uses a model already running on your machine."
        >
          {ollama.state === 'found' && ollama.models.length > 0 ? (
            <>
              <label className={label} htmlFor={ids.ol}>
                Model
              </label>
              <ModelSelect
                id={ids.ol}
                models={ollama.models}
                value={ollamaModel}
                onChange={setOllamaModel}
              />
            </>
          ) : (
            <ol className="list-decimal pl-5 text-sm leading-relaxed">
              <li>
                Install Ollama and pull a model, for example{' '}
                <code className="rounded-sm bg-code-bg px-1 font-mono">
                  ollama pull {OLLAMA_SUGGESTED_MODEL}
                </code>
                .
              </li>
              <li>
                Allow this site to reach it: set{' '}
                <code className="rounded-sm bg-code-bg px-1 font-mono break-all">
                  {ollamaOriginsHint(origin)}
                </code>{' '}
                and restart Ollama.
              </li>
              <li>
                Press <b>Check again</b>.
              </li>
            </ol>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={checkOllama}>
              Check again
            </Button>
            <span className="text-xs text-text-muted">
              Only the person who presses Send needs Ollama. The answer streams to everyone in the
              room.
            </span>
          </div>
        </Option>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </DialogShell>
  );
}

/** Mockup 10 B: the room uses a hosted model and this browser has no key for it. */
export function AddKeyDialog({
  open,
  onOpenChange,
  choice,
  myName,
  onSaved,
  onUseDemo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choice: RoomModelChoice;
  myName: string;
  onSaved: () => void;
  onUseDemo: () => void;
}) {
  const ids = { key: useId(), forget: useId() };
  const [value, setValue] = useState('');
  const [forget, setForget] = useState(false);
  const ep = findEndpoint(choice.endpoint);
  const model = ep?.models.find((m) => m.id === choice.model)?.label ?? choice.model;
  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) setValue('');
        onOpenChange(o);
      }}
      title="Add your key to send"
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
              onUseDemo();
            }}
          >
            Use the demo model instead
          </Button>
          <Button
            variant="primary"
            disabled={!value.trim()}
            onClick={() => {
              void keyStore.set(choice.endpoint ?? '', value, !forget).then(() => {
                setValue('');
                onOpenChange(false);
                onSaved();
              });
            }}
          >
            Save and send
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-text-muted">
        The room uses{' '}
        <b className="text-text">
          {ep?.label} · {model}
        </b>
        . You have no key for it in this browser.
      </p>
      <label className={label} htmlFor={ids.key}>
        {ep?.label} key
      </label>
      <input
        id={ids.key}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder="Paste your key"
        onChange={(e) => {
          setValue(e.target.value);
        }}
        className={cx(field, 'font-mono')}
        data-testid="add-key-input"
      />
      <label className="mt-3 flex items-center gap-2.5 text-sm" htmlFor={ids.forget}>
        <input
          id={ids.forget}
          type="checkbox"
          checked={forget}
          onChange={(e) => {
            setForget(e.target.checked);
          }}
          className="size-4 accent-[var(--c-accent)]"
        />
        Forget the key when I close this tab
      </label>
      <KeyNote endpointLabel={ep?.label ?? 'the provider'} owner={myName} />
    </DialogShell>
  );
}

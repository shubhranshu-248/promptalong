import { countO200k } from './count';

// Counts tokens off the main thread, so typing never waits for it. The encoding tables are only
// downloaded when the first count is asked for.
self.onmessage = (msg: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = msg.data;
  self.postMessage({ id, counts: texts.map(countO200k) });
};

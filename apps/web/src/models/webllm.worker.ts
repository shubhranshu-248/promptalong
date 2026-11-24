import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// Runs the in-browser model off the main thread, so typing never waits for it.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};

import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

// Text that merely looks like a control token ("<|endoftext|>") is counted as plain text, the way
// a chat API treats message content.
const OPTIONS = { disallowedSpecial: new Set<string>() };

/** Tokens of a text in the o200k_base encoding (exact for the models that use it). */
export function countO200k(text: string): number {
  return text.length === 0 ? 0 : countTokens(text, OPTIONS);
}

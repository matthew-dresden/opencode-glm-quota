/**
 * API key masking for user-facing output and logs.
 *
 * Keys are never printed. Wherever a key would appear, it is reduced to the
 * first four and last four characters joined by three dots (e.g.
 * `aaaa...dddd`) so users can still tell which credential a section refers
 * to. Keys too short to split safely (8 characters or fewer) are fully
 * masked so no character ever leaks.
 */

const MASK_SEPARATOR = '...';
const MIN_MASKABLE_LENGTH = 9;

/**
 * Mask an API key to first4/last4 (short keys are fully masked).
 * @param token - The API key to mask
 * @returns The masked key representation
 */
export function maskKey(token: string): string {
  if (token.length === 0) {
    return '';
  }

  if (token.length < MIN_MASKABLE_LENGTH) {
    return '*'.repeat(token.length);
  }

  return `${token.slice(0, 4)}${MASK_SEPARATOR}${token.slice(-4)}`;
}

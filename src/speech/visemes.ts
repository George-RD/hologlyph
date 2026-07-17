/**
 * Pure grapheme-to-viseme helpers for demo-mode speech.
 *
 * The demo adapter has no phoneme stream, so it derives mouth shapes from the
 * words the browser surfaces through `boundary` events. These functions turn a
 * boundary (a character offset into the utterance text) into a sequence of
 * canonical viseme morph names and the coupled jaw-open weight for each.
 *
 * Everything here is side-effect free and trivially unit-testable.
 */

import type { BlendshapeWeights } from '../contracts';

/** A letter or apostrophe marks a word character; everything else splits words. */
function isWordChar(ch: string): boolean {
  return /[A-Za-z'’]/.test(ch);
}

/**
 * Return the word a `boundary` event points at.
 *
 * When the browser supplies `charLength` we trust it and slice exactly that
 * many characters. Otherwise we scan forward from `charIndex`, collecting
 * word characters (letters and apostrophes); if `charIndex` lands on
 * whitespace or punctuation the result is empty.
 */
export function wordAt(text: string, charIndex: number, charLength = 0): string {
  if (charIndex < 0 || charIndex >= text.length) return '';
  if (charLength > 0) return text.slice(charIndex, charIndex + charLength);
  if (!isWordChar(text[charIndex] ?? '')) return '';
  let end = charIndex;
  while (end < text.length && isWordChar(text[end] ?? '')) end++;
  return text.slice(charIndex, end);
}

// Digraphs (and one trigram) are matched before single letters so that, for
// example, "tch" collapses to a single viseme and "sh" is not read as "s"+"h".
// Each entry maps a grapheme to one or more canonical viseme morph names.
const DIGRAPHS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['th', ['viseme_th']],
  ['tch', ['viseme_ch']],
  ['ch', ['viseme_ch']],
  ['sh', ['viseme_ch']],
  ['ph', ['viseme_ff']],
  ['oo', ['viseme_ou']],
  ['ee', ['viseme_ee']],
  ['ou', ['viseme_ou']],
  ['ow', ['viseme_ou']],
  // "qu" is an onset cluster: a velar stop followed by a rounded vowel.
  ['qu', ['viseme_kk', 'viseme_ou']],
];

// Single-letter mapping onto the canonical viseme vocabulary. Entries omitted
// here (h, x, and anything else) are skipped rather than mapped.
const SINGLES: Readonly<Record<string, string>> = {
  a: 'viseme_aa',
  e: 'viseme_ee',
  i: 'viseme_ih',
  y: 'viseme_ih',
  o: 'viseme_oh',
  u: 'viseme_ou',
  p: 'viseme_pp',
  b: 'viseme_pp',
  m: 'viseme_pp',
  f: 'viseme_ff',
  v: 'viseme_ff',
  d: 'viseme_dd',
  t: 'viseme_dd',
  l: 'viseme_dd',
  k: 'viseme_kk',
  g: 'viseme_kk',
  c: 'viseme_kk',
  j: 'viseme_ch',
  s: 'viseme_ss',
  z: 'viseme_ss',
  n: 'viseme_nn',
  r: 'viseme_rr',
  w: 'viseme_ou',
};

/**
 * Map a word onto a sequence of canonical viseme morph names. Matching is
 * case-insensitive; digraphs take precedence over single letters; unrecognised
 * characters are skipped. An empty word yields an empty sequence.
 */
export function visemeSequenceForWord(word: string): string[] {
  const lower = word.toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    for (const [graph, morphs] of DIGRAPHS) {
      if (lower.startsWith(graph, i)) {
        out.push(...morphs);
        i += graph.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const morph = SINGLES[lower[i] ?? ''];
    if (morph) out.push(morph);
    i++;
  }
  return out;
}

/** The silence frame: closed mouth, no viseme shape. */
export const SILENCE_FRAME_WEIGHTS: BlendshapeWeights = { viseme_sil: 1, jaw_open: 0 };

/**
 * Blendshape weights for a single viseme: the viseme morph at full weight.
 * No separate jaw_open coupling: the authored viseme targets already embed
 * their own jawOpen deltas (see VISEME_RECIPE in the asset pipeline), so
 * adding jaw_open here would double-open the mouth. jaw_open is pinned to 0
 * so the smoothed mouth channel releases any prior jaw pose during speech.
 */
export function weightsForViseme(viseme: string): BlendshapeWeights {
  return { [viseme]: 1, jaw_open: 0 };
}

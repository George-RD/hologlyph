#!/usr/bin/env bun
/**
 * Generate a deterministic Polly-shaped viseme fixture from espeak-ng.
 *
 * espeak-ng is GPLv3 and is a development-only tool. Its phoneme output is
 * converted to test data here, never shipped and never presented as a captured
 * AWS response. The generated JSONL is treated as data and remains outside the
 * npm package because package.json ships only dist/.
 *
 * How real timings are obtained:
 *   espeak-ng is driven through its native C API (phoneme-event callback with
 *   the IPA option) via a tiny embedded C helper. Each PHONEME event carries
 *   the exact `audio_position` in milliseconds for that phoneme within the
 *   synthesised utterance, so the marks below use espeak's own measured
 *   timings rather than a uniform guess. The helper is compiled once to the
 *   system temp dir and reused.
 *
 * Usage:
 *   bun tools/asset-pipeline/gen-viseme-fixture.ts [output.jsonl]
 *
 * With no argument the fixture is written to
 * test/fixtures/viseme-polly-hello.jsonl. JSONL is also printed to stdout.
 */
export {};

declare const Bun: {
  argv: string[];
  env: Record<string, string | undefined>;
  file(path: string | URL): { text(): Promise<string>; exists(): Promise<boolean> };
  write(path: string | URL, data: string | Uint8Array): Promise<number>;
  spawn(
    command: string[],
    options?: { stdout?: 'pipe' | 'inherit'; stderr?: 'pipe' | 'inherit' },
  ): { exited: Promise<number>; stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array> };
  which(command: string): string | null;
};

const PHRASE =
  'Papa ate a red cat. Go thought. The boy saw two blue shoes. Peter thinks Sally finds this dark key, and cheese is round.';
const DEFAULT_OUTPUT = 'test/fixtures/viseme-polly-hello.jsonl';

/** The complete Polly en-US viseme speech-mark alphabet (17 symbols). */
const POLLY_SYMBOLS = [
  'p',
  't',
  'S',
  'T',
  'f',
  'k',
  'i',
  'r',
  's',
  'u',
  '@',
  'a',
  'e',
  'E',
  'o',
  'O',
  'sil',
] as const;
type PollySymbol = (typeof POLLY_SYMBOLS)[number];

/** Explicit espeak IPA to Polly conversion. Unmapped phonemes are skipped. */
const ESPEAK_TO_POLLY: Readonly<Record<string, PollySymbol>> = {
  p: 'p',
  b: 'p',
  m: 'p',
  f: 'f',
  v: 'f',
  θ: 'T',
  ð: 'T',
  t: 't',
  d: 't',
  n: 't',
  l: 't',
  s: 's',
  z: 's',
  ʃ: 'S',
  ʒ: 'S',
  tʃ: 'S',
  dʒ: 'S',
  k: 'k',
  g: 'k',
  ŋ: 'k',
  ɹ: 'r',
  j: 'i',
  i: 'i',
  ɪ: 'i',
  iː: 'e',
  eɪ: 'e',
  ɛ: 'E',
  ɐ: '@',
  ə: '@',
  ɑ: 'a',
  'ɑː': 'a',
  a: 'a',
  aɪ: 'a',
  ɔɪ: 'o',
  oʊ: 'o',
  əʊ: 'o',
  ɔ: 'O',
  'ɔː': 'O',
  ʊ: 'u',
  uː: 'u',
  aʊ: 'u',
  w: 'u',
};

interface SpeechMark {
  time: number;
  type: 'viseme';
  value: PollySymbol;
}

/** Embedded C helper: prints "<ms>\\t<ipa-phoneme>" per PHONEME event. */
const C_HELPER_SOURCE = `#include <espeak-ng/speak_lib.h>
#include <stdio.h>
#include <string.h>

static int synth_callback(short *wav, int numsamples, espeak_EVENT *events) {
  (void)wav; (void)numsamples;
  if (events == NULL) return 0;
  for (int i = 0; events[i].type != espeakEVENT_LIST_TERMINATED; i++) {
    espeak_EVENT *e = &events[i];
    if (e->type == espeakEVENT_PHONEME) {
      printf("%d\\t%s\\n", e->audio_position, e->id.string);
    } else if (e->type == espeakEVENT_END) {
      printf("%d\\t__END__\\n", e->audio_position);
    }
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  // Pin the voice and rate so the produced phoneme timings are identical across
  // machines (default voice/rate otherwise vary by espeak-ng install).
  espeak_Initialize(AUDIO_OUTPUT_RETRIEVAL, 0, NULL,
                    espeakINITIALIZE_PHONEME_EVENTS | espeakINITIALIZE_PHONEME_IPA);
  espeak_SetVoiceByName("en-us");
  espeak_SetParameter(espeakRATE, 175, 0);
  espeak_SetSynthCallback(&synth_callback);
  const char *text = argv[1];
  espeak_Synth(text, strlen(text) + 1, 0, POS_CHARACTER, 0,
               espeakCHARS_UTF8, NULL, NULL);
  espeak_Synchronize();
  espeak_Terminate();
  return 0;
}
`;

interface TimedPhoneme {
  ms: number;
  ipa: string;
}

interface CompileArgs {
  cflags: string[];
  libs: string[];
}

/**
 * Resolve espeak-ng compile flags via pkg-config so the generator survives an
 * espeak-ng upgrade or a non-Homebrew install. Falls back to probing known
 * Homebrew include roots when pkg-config is unavailable.
 */
async function resolveCompileArgs(): Promise<CompileArgs> {
  const pc = Bun.spawn(['pkg-config', '--cflags', '--libs', 'espeak-ng'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, exitCode] = await Promise.all([
    new Response(pc.stdout).text(),
    pc.exited,
  ]);
  if (exitCode === 0 && out.trim().length > 0) {
    const flags = out.trim().split(/\s+/).filter((f) => f.length > 0);
    const cflags = flags.filter((f) => f.startsWith('-I'));
    let libs = flags.filter((f) => !f.startsWith('-I'));
    const libDir = libs.find((f) => f.startsWith('-L'))?.slice(2);
    if (libDir) libs = [...libs, `-Wl,-rpath,${libDir}`];
    if (cflags.length > 0) return { cflags, libs };
  }

  const cellar = '/opt/homebrew/Cellar/espeak-ng';
  const fallbackIncludes = [`${cellar}/1.52.0/include`, '/usr/local/include'];
  for (const inc of fallbackIncludes) {
    if (await Bun.file(`${inc}/espeak-ng/speak_lib.h`).exists()) {
      return {
        cflags: [`-I${inc}`],
        libs: ['-L/opt/homebrew/lib', '-lespeak-ng', '-Wl,-rpath,/opt/homebrew/lib'],
      };
    }
  }
  throw new Error('espeak-ng development files not found (need pkg-config or Homebrew espeak-ng).');
}

async function buildHelper(args: CompileArgs, binPath: string): Promise<void> {
  const tmp = Bun.env.TMPDIR ?? '/tmp';
  const cPath = `${tmp}/hologlyph-espeak-phonemes.c`;
  await Bun.write(cPath, C_HELPER_SOURCE);
  const child = Bun.spawn(
    ['clang', '-O2', ...args.cflags, cPath, ...args.libs, '-o', binPath],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const error = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`failed to compile espeak helper (${exitCode}): ${error.trim()}`);
  }
}

async function readPhonemeTimings(
  binPath: string,
): Promise<{ phonemes: TimedPhoneme[]; endMs: number }> {
  const child = Bun.spawn([binPath, PHRASE], { stdout: 'pipe', stderr: 'pipe' });
  const [raw, error, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`espeak helper failed (${exitCode}): ${error.trim()}`);
  }
  const phonemes: TimedPhoneme[] = [];
  let endMs = 0;
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const ms = Number.parseInt(line.slice(0, tab), 10);
    const value = line.slice(tab + 1);
    if (!Number.isFinite(ms)) continue;
    if (value === '__END__') {
      endMs = Math.max(endMs, ms);
      continue;
    }
    if (value.length === 0) continue; // word-gap events carry no phoneme name
    phonemes.push({ ms, ipa: value });
  }
  return { phonemes, endMs };
}

function toSpeechMarks(phonemes: readonly TimedPhoneme[], endMs: number): SpeechMark[] {
  const marks: SpeechMark[] = [{ time: 0, type: 'viseme', value: 'sil' }];
  for (const { ms, ipa } of phonemes) {
    const bare = ipa.replace(/[ˈˌ]/gu, '');
    const symbol = ESPEAK_TO_POLLY[bare];
    if (!symbol) continue;
    marks.push({ time: ms, type: 'viseme', value: symbol });
  }
  const finalSilence = endMs > 0 ? endMs : marks[marks.length - 1]!.time + 1;
  marks.push({ time: finalSilence, type: 'viseme', value: 'sil' });

  const emitted = new Set(marks.map((mark) => mark.value));
  const required = POLLY_SYMBOLS.filter((symbol) => symbol !== 'sil');
  const missing = required.filter((symbol) => !emitted.has(symbol));
  if (missing.length > 0) {
    throw new Error(`fixture phrase did not cover Polly symbols: ${missing.join(', ')}`);
  }
  return marks;
}
async function main(): Promise<void> {
  const tmp = Bun.env.TMPDIR ?? '/tmp';
  // Key the helper binary by a hash of its source so edits to the C helper force
  // a clean rebuild instead of silently reusing stale compiled code.
  let sig = 0;
  for (const ch of C_HELPER_SOURCE) sig = (sig * 31 + ch.charCodeAt(0)) >>> 0;
  const binPath = `${tmp}/hologlyph-espeak-phonemes-${sig.toString(36)}`;
  const args = await resolveCompileArgs();
  if (!(await Bun.file(binPath).exists())) {
    await buildHelper(args, binPath);
  }
  const { phonemes, endMs } = await readPhonemeTimings(binPath);
  const marks = toSpeechMarks(phonemes, endMs);
  const jsonl = `${marks.map((mark) => JSON.stringify(mark)).join('\n')}\n`;
  const outputPath = Bun.argv[2] ?? DEFAULT_OUTPUT;
  await Bun.write(outputPath, jsonl);
  console.log(jsonl);
}

await main();

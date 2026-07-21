#!/usr/bin/env bun
/**
 * hologlyph asset pipeline — offline glTF optimisation.
 *
 * Build-time only. This tool is NEVER bundled into the runtime (dec.hologlyph-blueprint:
 * the pipeline lives under tools/, not src/). It squeezes a source .glb toward the
 * < 1.5 MB GLB delivery budget (dec.performance-budget) using glTF-Transform plus
 * Meshopt geometry compression, and (when the KTX-Software `toktx` CLI is available)
 * Basis Universal (KTX2) texture compression.
 *
 * Usage:
 *   bun tools/asset-pipeline/optimize.ts <input.glb> [output.glb]
 *   npm run optimize-asset -- <input.glb> [output.glb]
 *
 * Behaviour notes:
 *   - KTX2/BasisU requires `toktx` on PATH. If it is missing we print a clear
 *     message and skip texture compression; the model still ships.
 *   - Texture resize/compress uses glTF-Transform's `textureCompress`. For best
 *     results install the `sharp` encoder; without it, resize is skipped with a
 *     message.
 *   - Exits with code 1 (and a clear message) when the optimised GLB exceeds the
 *     1.5 MB delivery budget.
 */

// Bun/Node globals used by this CLI. The project tsconfig restricts `types` to
// `vite/client`, so we declare the small surface we rely on here. This file is
// excluded from the browser bundle (tools/, not src/), so the declarations
// never leak into runtime code.
declare const Bun: {
  argv: string[];
  file(path: string | URL): {
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  };
  write(path: string | URL, data: Uint8Array | ArrayBuffer | string): Promise<number>;
  which(command: string): string | null;
  spawn(
    command: string[],
    options?: { cwd?: string; stdout?: 'inherit' | 'pipe'; stderr?: 'inherit' | 'pipe' },
  ): { exited: Promise<number>; stdout?: ReadableStream<Uint8Array>; stderr?: ReadableStream<Uint8Array> };
};
declare const process: { exit(code?: number): never };

import { WebIO, type Document } from '@gltf-transform/core';
import { dedup, prune, quantize, reorder, simplify, textureCompress } from '@gltf-transform/functions';
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
  KHRTextureBasisu,
} from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

/** GLB delivery budget from dec.performance-budget (< 1.5 MB). */
const DELIVERY_BUDGET_BYTES = 1.5 * 1024 * 1024;

interface Logger {
  info(message: string): void;
  warn(message: string): void;
  note(message: string): void;
}

function makeLogger(): Logger {
  return {
    info: (m) => console.log(`[optimize] ${m}`),
    warn: (m) => console.warn(`[optimize] ${m}`),
    note: (m) => console.log(`[optimize] ${m}`),
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

async function readBytes(path: string): Promise<Uint8Array> {
  const buffer = await Bun.file(path).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Convert every raster texture to Basis Universal (KTX2) when `toktx` is on PATH.
 * If toktx is unavailable we skip with a clear message rather than failing.
 */
async function compressTexturesKTX2(doc: Document, logger: Logger): Promise<void> {
  const toktx = Bun.which('toktx');
  if (!toktx) {
    logger.note(
      'KTX2/BasisU: `toktx` not found on PATH. Skipping GPU texture compression. ' +
        'Install KTX-Software (toktx) to enable Basis Universal textures; the delivery ' +
        'budget can still be met with meshopt + prune for geometry-light busts.',
    );
    return;
  }

  const textures = doc.getRoot().listTextures();
  if (textures.length === 0) return;

  // Register the extension so writers emit KHR_texture_basisu for ktx2 textures.
  doc.createExtension(KHRTextureBasisu).setRequired(false);

  let converted = 0;
  for (let i = 0; i < textures.length; i++) {
    const texture = textures[i]!;
    const image = texture.getImage();
    if (!image || texture.getMimeType() === 'image/ktx2') continue;
    const tmpIn = `./.hologlyph-tmp-${i}.png`;
    const tmpOut = `./.hologlyph-tmp-${i}.ktx2`;
    try {
      await Bun.write(tmpIn, image);
      const proc = Bun.spawn([toktx, '--bcmp', tmpOut, tmpIn], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const code = await proc.exited;
      if (code !== 0) {
        logger.warn(`toktx failed (exit ${code}) for a texture; skipping it.`);
        continue;
      }
      const ktx2 = new Uint8Array(await Bun.file(tmpOut).arrayBuffer());
      texture.setImage(ktx2);
      texture.setMimeType('image/ktx2');
      converted++;
    } catch (err) {
      logger.warn(`KTX2 conversion failed for a texture: ${(err as Error).message}`);
    }
  }
  logger.info(`KTX2: converted ${converted}/${textures.length} textures.`);
}
async function main(): Promise<void> {
  const logger = makeLogger();
  const rawArgs = Bun.argv.slice(2);
  // --simplify <ratio>: meshopt decimation before compression. Morph deltas are
  // remapped onto the simplified vertices; visual keyframe checks pick the ratio.
  let simplifyRatio = 0;
  const simplifyIdx = rawArgs.indexOf('--simplify');
  if (simplifyIdx !== -1) {
    simplifyRatio = Number(rawArgs[simplifyIdx + 1] ?? '');
    rawArgs.splice(simplifyIdx, 2);
    if (!(simplifyRatio > 0 && simplifyRatio < 1)) {
      logger.warn('--simplify expects a ratio in (0, 1)');
      process.exit(1);
    }
  }
  const args = rawArgs;
  const input = args[0];
  if (!input) {
    logger.warn('Usage: optimize-asset <input.glb> [output.glb] [--simplify <ratio>]');
    process.exit(1);
  }
  const io = new WebIO()
    .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression, KHRTextureBasisu])
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });
  const output = args[1] ?? input.replace(/\.glb$/i, '.optimized.glb');

  // Meshopt wasm codecs must be initialised before reading/writing.
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;


  logger.info(`Reading ${input} …`);
  const inputBytes = await readBytes(input);
  logger.info(`Input size: ${formatBytes(inputBytes.byteLength)}`);
  const doc = await io.readBinary(inputBytes);

  // keepAttributes: retain NORMAL/TEXCOORD_0 even though the shipped material
  // binds no map (the runtime swaps in the text-skin material, which samples uv()
  // and needs normals for lighting). keepLeaves: retain the skeleton joint nodes.
  if (simplifyRatio > 0) {
    await MeshoptSimplifier.ready;
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.001 }),
    );
    const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
    const count = prim?.getAttribute('POSITION')?.getCount() ?? 0;
    logger.info(`Simplify: ratio ${simplifyRatio} -> ${count} vertices.`);
  }
  // Quantisation policy (2026-07-21, owner-visible mesh tears): int16
  // quantisation of the BASE position attribute on this skinned
  // multi-primitive bust makes scattered triangles render black/void in
  // three's WebGPU path (fixed surface spots, angle-dependent; bisected by
  // attribute - position-only quantise reproduces, no-position quantise is
  // clean; volumes, reorder, simplify, filters, morphs all exonerated).
  // Base POSITION therefore stays float32; morph-target deltas and every
  // other attribute are quantised, and EXT_meshopt_compression recovers the
  // bulk (delivery ~1.09 MB vs 1.01 MB fully quantised).
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true, keepLeaves: true }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({
      pattern: /^(TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/,
      patternTargets: /^(POSITION|NORMAL|TANGENT)(_\d+)?$/,
      quantizeNormal: 8,
    }),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });

  // Best-effort texture resize. Requires an image backend (sharp); without it
  // glTF-Transform cannot resize, so we skip with a clear message.
  try {
    await doc.transform(textureCompress({ resize: [1024, 1024] }));
  } catch (err) {
    logger.note(
      `Texture resize skipped: ${(err as Error).message}. ` +
        'Install the `sharp` package to enable texture resize/compress.',
    );
  }

  await compressTexturesKTX2(doc, logger);

  const out = await io.writeBinary(doc);
  await Bun.write(output, out);
  const outBytes = out.byteLength;
  logger.info(`Output written to ${output}: ${formatBytes(outBytes)}`);

  if (outBytes > DELIVERY_BUDGET_BYTES) {
    logger.warn(
      `Delivery budget exceeded: ${formatBytes(outBytes)} > ${formatBytes(DELIVERY_BUDGET_BYTES)} ` +
        '(dec.performance-budget: GLB delivery target < 1.5 MB).',
    );
    process.exit(1);
  }
  logger.info('Within delivery budget. Done.');
}

main().catch((err) => {
  console.error(`[optimize] failed: ${(err as Error).message}`);
  process.exit(1);
});

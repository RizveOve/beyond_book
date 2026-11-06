// Compresses a GLB in place with meshopt + quantization (decoded in the app by
// three.js's MeshoptDecoder). Typically shrinks procedural models ~4-6x.
//
//   node scripts/compress-glb.mjs [file=public/models/heart.glb]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] ?? 'public/models/heart.glb');
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const before = (await stat(file)).size;
const doc = await io.read(file);
await doc.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(file, doc);
const after = (await stat(file)).size;
console.log(`Compressed ${file}: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(2)} MB`);

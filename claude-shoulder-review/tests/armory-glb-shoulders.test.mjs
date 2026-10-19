import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
import { attachDetachedShoulders, attachShoulderAssets, deriveShoulderAttachments, CONFIRMED_SHOULDER_ATTACHMENTS } from '../src/wf-armory-import.mjs';

const dataUrl = (name) => new URL(`../data/${name}`, import.meta.url);
const hasData = await access(dataUrl('scourgefemale_hd.glb')).then(() => true, () => false);
const loadData = async (name) => new Blob([await readFile(dataUrl(name))], { type: 'model/gltf-binary' });

function makeGlb(document, binary = null) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = (json.length + 3) & ~3;
  const binLength = binary ? (binary.length + 3) & ~3 : 0;
  const bytes = new Uint8Array(20 + paddedLength + (binary ? 8 + binLength : 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + paddedLength);
  bytes.set(json, 20);
  if (binary) {
    view.setUint32(20 + paddedLength, binLength, true);
    view.setUint32(24 + paddedLength, 0x004e4942, true);
    bytes.set(binary, 28 + paddedLength);
  }
  return new Blob([bytes], { type: 'model/gltf-binary' });
}

async function readGlb(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  let binary = null;
  if (20 + length + 8 <= bytes.length) {
    const binLength = view.getUint32(20 + length, true);
    binary = bytes.subarray(28 + length, 28 + length + binLength);
  }
  return { bytes, json, binary };
}

const round = (values) => Array.from(values).map((n) => Math.round(n * 1e6) / 1e6);
const translationOf = (matrix) => round(matrix.slice(12, 15));

const detachedShoulders = () => ({
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  skins: [{ joints: [1, 2, 3], skeleton: 0 }],
  meshes: [{ primitives: [] }, { primitives: [] }],
  nodes: [
    { name: 'character-root', children: [1, 4, 5], translation: [3, 0, 0] },
    { name: 'bone_Root', children: [2, 3], translation: [0, 1, 0] },
    { name: 'bone_ShoulderL', translation: [0, 2, 0] },
    { name: 'bone_ShoulderR', translation: [0, -1, 0] },
    { name: 'Shoulder (L)_Item16536_0', mesh: 0, scale: [1.5, 1.5, 1.5] },
    { name: 'Shoulder (R)_Item16536_0', mesh: 1 }
  ]
});

// Hypothetical attachment points used only to check the matrix algebra.
const attachments = { L: { position: [0.1, 2.5, -0.2] }, R: { position: [0.1, 2.5, 0.2] } };

function assertDetachedResult(json) {
  assert.deepEqual(json.nodes[0].children, [1]);
  assert.deepEqual(json.nodes[2].children, [4]);
  assert.deepEqual(json.nodes[3].children, [5]);
  // bone_ShoulderL world = (3, 3, 0); item world must be root(3,0,0) + attachment.
  assert.deepEqual(translationOf(json.nodes[4].matrix), [0.1, -0.5, -0.2]);
  assert.equal(json.nodes[4].matrix[0], 1.5, 'the node keeps its own scale, nothing is added');
  // bone_ShoulderR world = (3, 0, 0).
  assert.deepEqual(translationOf(json.nodes[5].matrix), [0.1, 2.5, 0.2]);
  assert.deepEqual(round(json.nodes[5].matrix.slice(0, 11)), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

test('origin-detached wow.export shoulders are placed at the confirmed attachment point under their joints', async () => {
  const result = await attachDetachedShoulders(makeGlb(detachedShoulders()), attachments);
  assert.equal(result.attached, 2);
  assert.deepEqual(result.missing, []);
  const { bytes, json } = await readGlb(result.blob);
  assert.equal(new DataView(bytes.buffer).getUint32(8, true), bytes.length);
  assertDetachedResult(json);
});

test('a confirmed attachment bone and scale are applied', async () => {
  // Parent under bone_Root (world (3, 1, 0)) with the measured kind of record.
  const result = await attachDetachedShoulders(makeGlb(detachedShoulders()), {
    L: { bone: 'bone_Root', position: [0.1, 2.5, -0.2], scale: 0.65 }
  });
  assert.equal(result.attached, 1);
  assert.deepEqual(result.missing, ['R']);
  const { json } = await readGlb(result.blob);
  assert.ok(json.nodes[1].children.includes(4));
  assert.deepEqual(translationOf(json.nodes[4].matrix), [0.1, 1.5, -0.2]);
  assert.ok(Math.abs(json.nodes[4].matrix[0] - 1.5 * 0.65) < 1e-9, 'item scale 1.5 times attachment scale 0.65');
});

test('without confirmed attachment data detached shoulders are not moved by guesswork', async () => {
  const file = makeGlb(detachedShoulders());
  const result = await attachDetachedShoulders(file);
  assert.equal(result.attached, 0);
  assert.deepEqual(result.missing, ['L', 'R']);
  assert.equal(result.blob, file);
});

test('already attached shoulder meshes are left intact', async () => {
  const gltf = detachedShoulders();
  gltf.nodes[0].children = [1];
  gltf.nodes[2].children = [4];
  gltf.nodes[3].children = [5];
  gltf.nodes[4].translation = [0.02, 0.1, 0];
  const file = makeGlb(gltf);
  const result = await attachDetachedShoulders(file, attachments);
  assert.equal(result.attached, 0);
  assert.equal(result.blob, file);
});

test('unmatched or non-skeletal shoulder meshes are not moved', async () => {
  const gltf = detachedShoulders();
  gltf.skins[0].joints = [];
  const file = makeGlb(gltf);
  const result = await attachDetachedShoulders(file, attachments);
  assert.equal(result.attached, 0);
  assert.equal(result.blob, file);
});

test('the browser-loaded shoulder fix matches the module', async () => {
  const window = { WFArmoryImport: {} };
  const source = await readFile(new URL('../src/wf-armory-shoulder-fix.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { window, Blob, TextEncoder, TextDecoder, DataView, Uint8Array, Map, Set, JSON, Number, Math, String, Error, Array });
  const result = await window.WFArmoryImport.attachDetachedShoulders(makeGlb(detachedShoulders()), attachments);
  assert.equal(result.attached, 2);
  assertDetachedResult((await readGlb(result.blob)).json);
  const scaled = await window.WFArmoryImport.attachDetachedShoulders(makeGlb(detachedShoulders()), { L: { bone: 'bone_Root', position: [0.1, 2.5, -0.2], scale: 0.65 } });
  const scaledModule = await attachDetachedShoulders(makeGlb(detachedShoulders()), { L: { bone: 'bone_Root', position: [0.1, 2.5, -0.2], scale: 0.65 } });
  assert.deepEqual(round((await readGlb(scaled.blob)).json.nodes[4].matrix), round((await readGlb(scaledModule.blob)).json.nodes[4].matrix));
  const missing = await window.WFArmoryImport.attachDetachedShoulders(makeGlb(detachedShoulders()));
  assert.equal(missing.attached, 0);
  assert.deepEqual(Array.from(missing.missing), ['L', 'R']);
});

/** A minimal one-mesh item GLB in the wow.export layout (POSITION, TEXCOORD_0, uint16 indices). */
function makeItemGlb(positions, uvs, indices, nodes = [{ mesh: 0 }]) {
  const posBytes = new Float32Array(positions.flat());
  const uvBytes = new Float32Array(uvs.flat());
  const indexBytes = new Uint16Array(indices);
  const binary = new Uint8Array(posBytes.byteLength + uvBytes.byteLength + ((indexBytes.byteLength + 3) & ~3));
  binary.set(new Uint8Array(posBytes.buffer), 0);
  binary.set(new Uint8Array(uvBytes.buffer), posBytes.byteLength);
  binary.set(new Uint8Array(indexBytes.buffer), posBytes.byteLength + uvBytes.byteLength);
  return makeGlb({
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength },
      { buffer: 0, byteOffset: posBytes.byteLength, byteLength: uvBytes.byteLength },
      { buffer: 0, byteOffset: posBytes.byteLength + uvBytes.byteLength, byteLength: indexBytes.byteLength }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: uvs.length, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 }] }],
    nodes
  }, binary);
}

/** wow.export OBJ layout: body first, then the posed item; only used vertices, original order, flipped V. */
function makeReferenceObj(sides) {
  const lines = ['# Exported using wow.export v0.2.19', 'o scourgefemale_hd', 'v 0 0 0', 'v 0 1 0', 'v 1 0 0'];
  const uvLines = ['vt 0 0', 'vt 0 1', 'vt 1 0'];
  const faces = ['g Geoset0', 'f 1/1/1 2/2/2 3/3/3'];
  let offset = 3;
  for (const { side, itemId, positions, uvs, indices, transform } of sides) {
    positions.forEach((p) => lines.push(`v ${transform(p).join(' ')}`));
    uvs.forEach(([u, v]) => uvLines.push(`vt ${u} ${1 - v}`));
    faces.push(`g Shoulder (${side})_Item${itemId}_0`);
    for (let i = 0; i < indices.length; i += 3) {
      faces.push('f ' + indices.slice(i, i + 3).map((index) => `${index + offset + 1}/${index + offset + 1}/${index + offset + 1}`).join(' '));
    }
    offset += positions.length;
  }
  return [...lines, ...uvLines, ...faces].join('\n');
}

const cube = {
  positions: [[-0.2, -0.3, -0.1], [0.2, -0.3, -0.1], [0.2, 0.3, -0.1], [-0.2, 0.3, -0.1], [-0.2, -0.3, 0.4], [0.2, -0.3, 0.4], [0.2, 0.3, 0.4], [-0.2, 0.3, 0.4]],
  uvs: [[0, 0], [0.1, 0.2], [0.3, 0.1], [0.4, 0.5], [0.6, 0.2], [0.7, 0.9], [0.8, 0.3], [0.9, 0.7]],
  indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 4, 7]
};

test('attachment points are derived exactly from a rest-pose wow.export OBJ', async () => {
  const offset = [0.01, 1.62, -0.16];
  const obj = makeReferenceObj([{ side: 'L', itemId: 123, ...cube, transform: (p) => p.map((v, i) => v + offset[i]) }]);
  const result = await deriveShoulderAttachments(obj, { L: makeItemGlb(cube.positions, cube.uvs, cube.indices) });
  assert.equal(result.L.itemId, 123);
  assert.deepEqual(round(result.L.position).map((n) => Math.round(n * 1e5) / 1e5), offset);
  assert.ok(Math.abs(result.L.scale - 1) < 1e-5);
  assert.ok(result.L.rms < 1e-6);
});

test('attachment points can use any shoulder from a GLB export of the same character', async () => {
  const offset = [0.01, 1.62, 0.16];
  const obj = makeReferenceObj([{ side: 'R', itemId: 456, ...cube, transform: (p) => p.map((v, i) => v + offset[i]) }]);
  const character = makeItemGlb(cube.positions, cube.uvs, cube.indices, [
    { name: 'scourgefemale_hd_Geoset0', mesh: 0, skin: 0 },
    { name: 'Shoulder (R)_Item456_0', mesh: 0 }
  ]);
  const result = await deriveShoulderAttachments(obj, { character });
  assert.deepEqual(Object.keys(result), ['R']);
  assert.equal(result.R.itemId, 456);
  assert.deepEqual(result.R.position.map((n) => Math.round(n * 1e5) / 1e5), offset);
});

test('the preview rotation wow.export adds to attached items in OBJ is stripped', async () => {
  const offset = [0.01, 1.62, -0.16];
  const yaw = -95 * Math.PI / 180;
  const rotate = ([x, y, z]) => [Math.cos(yaw) * x + Math.sin(yaw) * z, y, -Math.sin(yaw) * x + Math.cos(yaw) * z];
  const obj = makeReferenceObj([{ side: 'L', itemId: 123, ...cube, transform: (p) => rotate(p.map((v, i) => v + offset[i])) }]);
  const result = await deriveShoulderAttachments(obj, { L: makeItemGlb(cube.positions, cube.uvs, cube.indices) });
  assert.ok(Math.abs(result.L.previewRotation + 95) < 1e-3);
  assert.deepEqual(result.L.position.map((n) => Math.round(n * 1e5) / 1e5), offset);
});

test('a scaled or posed reference is rejected instead of being baked in', async () => {
  const obj = makeReferenceObj([{ side: 'L', itemId: 123, ...cube, transform: (p) => p.map((v) => v * 0.8) }]);
  await assert.rejects(deriveShoulderAttachments(obj, { L: makeItemGlb(cube.positions, cube.uvs, cube.indices) }), /не в позе покоя \(масштаб 0\.8000/);
});

test('a reference made from another model is rejected', async () => {
  const obj = makeReferenceObj([{ side: 'L', itemId: 123, ...cube, indices: cube.indices.slice(0, 6), transform: (p) => p }]);
  await assert.rejects(deriveShoulderAttachments(obj, { L: makeItemGlb(cube.positions, cube.uvs, cube.indices) }), /вершин наплечника/);
});

test('uploaded wow.export shoulder GLBs: derived attachment round-trips and merges at 1:1 size', { skip: !hasData && 'нет data/*.glb' }, async () => {
  const body = await loadData('scourgefemale_hd.glb');
  const left = await loadData('shoulder_armor_skybornec60_d_01_l_7751193.glb');
  const right = await loadData('shoulder_armor_skybornec60_d_01_r.glb');

  // Build an OBJ from the real item vertices with a known test offset to check
  // the accessor reading and vertex ordering on wow.export data.
  const sides = [];
  for (const [side, file, offset] of [['L', left, [0.03, 1.6, -0.17]], ['R', right, [0.03, 1.6, 0.17]]]) {
    const { json, binary } = await readGlb(file);
    const primitive = json.meshes[0].primitives[0];
    const read = (index, size) => {
      const accessor = json.accessors[index];
      const view = json.bufferViews[accessor.bufferView];
      const start = binary.byteOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
      return Array.from({ length: accessor.count }, (_, i) => Array.from(new Float32Array(binary.buffer.slice(start + i * size * 4, start + (i + 1) * size * 4))));
    };
    const accessor = json.accessors[primitive.indices];
    const view = json.bufferViews[accessor.bufferView];
    const start = binary.byteOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const indices = Array.from(accessor.componentType === 5125
      ? new Uint32Array(binary.buffer.slice(start, start + accessor.count * 4))
      : new Uint16Array(binary.buffer.slice(start, start + accessor.count * 2)));
    sides.push({ side, itemId: 999, positions: read(primitive.attributes.POSITION, 3), uvs: read(primitive.attributes.TEXCOORD_0, 2), indices, transform: (p) => p.map((v, i) => v + offset[i]), offset });
  }
  const derived = await deriveShoulderAttachments(makeReferenceObj(sides), { L: left, R: right });
  for (const { side, offset } of sides) {
    derived[side].position.forEach((value, i) => assert.ok(Math.abs(value - offset[i]) < 1e-5, `${side}: ${derived[side].position}`));
    assert.ok(Math.abs(derived[side].scale - 1) < 1e-5);
  }

  await assert.rejects(attachShoulderAssets(body, [{ side: 'L', name: 'left-test', file: left }]), /нет подтверждённой точки крепления/);

  const result = await attachShoulderAssets(body, [
    { side: 'L', name: 'left-test', file: left, attachment: derived.L },
    { side: 'R', name: 'right-test', file: right, attachment: derived.R }
  ]);
  assert.equal(result.attached, 2);
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const header = new DataView(bytes.buffer);
  assert.equal(header.getUint32(8, true), bytes.length);
  const jsonLength = header.getUint32(12, true);
  const binHeader = 20 + jsonLength;
  assert.equal(header.getUint32(binHeader + 4, true), 0x004e4942);
  const binLength = header.getUint32(binHeader, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, binHeader)).trim());
  assert.ok(json.images.length >= 11, 'both source GLBs keep their embedded textures');
  assert.ok(json.materials.some((material) => material.name?.startsWith('shoulder_armor_skybornec60')));

  const parents = new Map();
  json.nodes.forEach((node, index) => (node.children || []).forEach((child) => parents.set(child, index)));
  const worldTranslation = (index) => {
    let sum = [0, 0, 0];
    for (let current = index; current !== undefined; current = parents.get(current)) {
      const node = json.nodes[current];
      const t = node.matrix ? node.matrix.slice(12, 15) : node.translation || [0, 0, 0];
      sum = sum.map((v, i) => v + t[i]);
    }
    return sum;
  };
  for (const { side, offset } of sides) {
    const nodeIndex = json.nodes.findIndex((node) => node.name === `WFArmory_${side}_Shoulder_${side === 'L' ? 'left-test' : 'right-test'}`);
    const boneIndex = json.nodes.findIndex((node) => node.name === `bone_Shoulder${side}`);
    assert.ok(json.nodes[boneIndex].children.includes(nodeIndex));
    const node = json.nodes[nodeIndex];
    assert.deepEqual(round(node.matrix.slice(0, 11)), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'no scale or rotation is added to the item');
    worldTranslation(nodeIndex).forEach((value, i) => assert.ok(Math.abs(value - offset[i]) < 1e-5));
    const primitive = json.meshes[node.mesh].primitives[0];
    assert.equal(primitive.attributes.JOINTS_0, undefined);
    assert.equal(primitive.attributes.WEIGHTS_0, undefined);
    assert.ok(primitive.attributes.POSITION !== undefined);
  }
  for (const view of json.bufferViews) {
    assert.ok((view.byteOffset || 0) + view.byteLength <= binLength, 'bufferView remains inside the rewritten binary chunk');
  }
});

test('confirmed scourgefemale_hd attachments put the uploaded shoulders on the arm bones at 0.65', { skip: !hasData && 'нет data/*.glb' }, async () => {
  const body = await loadData('scourgefemale_hd.glb');
  const confirmed = CONFIRMED_SHOULDER_ATTACHMENTS.scourgefemale_hd;
  const result = await attachShoulderAssets(body, [
    { side: 'L', name: 'left', file: await loadData('shoulder_armor_skybornec60_d_01_l_7751193.glb'), attachment: confirmed.L },
    { side: 'R', name: 'right', file: await loadData('shoulder_armor_skybornec60_d_01_r.glb'), attachment: confirmed.R }
  ]);
  const { json } = await readGlb(result.blob);
  const parents = new Map();
  json.nodes.forEach((node, index) => (node.children || []).forEach((child) => parents.set(child, index)));
  for (const side of ['L', 'R']) {
    const nodeIndex = json.nodes.findIndex((node) => node.name === `WFArmory_${side}_Shoulder_${side === 'L' ? 'left' : 'right'}`);
    assert.equal(json.nodes[parents.get(nodeIndex)].name, `bone_Arm${side}`);
    const matrix = json.nodes[nodeIndex].matrix;
    assert.deepEqual(round(matrix.slice(0, 11)), [0.65, 0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0.65]);
    let world = matrix.slice(12, 15);
    for (let current = parents.get(nodeIndex); current !== undefined; current = parents.get(current)) {
      world = world.map((value, i) => value + (json.nodes[current].translation || [0, 0, 0])[i]);
    }
    world.forEach((value, i) => assert.ok(Math.abs(value - confirmed[side].position[i]) < 1e-6));
  }
});

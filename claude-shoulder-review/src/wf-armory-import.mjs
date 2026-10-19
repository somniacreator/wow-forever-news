const WOW_EXPORT_SLOT_NAMES = {
  1: 'head', 2: 'neck', 3: 'shoulder', 4: 'shirt', 5: 'chest',
  6: 'waist', 7: 'legs', 8: 'feet', 9: 'wrist', 10: 'hands',
  11: 'finger1', 12: 'finger2', 13: 'trinket1', 14: 'trinket2',
  15: 'back', 16: 'mainhand', 17: 'offhand', 18: 'ranged',
  19: 'tabard', 20: 'chest'
};

const WOW_EXPORT_RACES = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf',
  5: 'Scourge', 6: 'Tauren', 7: 'Gnome', 8: 'Troll'
};

function normalizeWowExportCharacter(data) {
  const raceId = Number(data.race_id);
  const modelId = Number(data.model_id);
  const items = {};
  const unsupportedSlots = [];

  for (const [rawSlot, rawId] of Object.entries(data.equipment)) {
    const slot = WOW_EXPORT_SLOT_NAMES[Number(rawSlot)];
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (!slot) {
      unsupportedSlots.push(rawSlot);
      continue;
    }
    items[slot] = { item_id: id, name: `Предмет #${id}` };
  }

  const thumb = typeof data.thumb === 'string' &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data.thumb)
    ? data.thumb
    : '';

  return {
    name: 'Персонаж из wow.export',
    race: WOW_EXPORT_RACES[raceId] || `Раса ${raceId}`,
    class: '',
    realm: 'wow.export',
    region: 'eu',
    gear: { items },
    __wowExportCharacter: {
      version: 2,
      raceId,
      modelId,
      choices: data.choices,
      clientVersion: data.client?.version || '',
      clientBuild: String(data.client?.build || ''),
      equipment: data.equipment,
      guildTabard: data.guild_tabard || null,
      thumb,
      unsupportedSlots
    }
  };
}

export function normalizeArmoryImport(data) {
  if (data && typeof data === 'object' && !Array.isArray(data) &&
      Number(data.version) === 2 && Number(data.race_id) > 0 &&
      Number(data.model_id) > 0 && Array.isArray(data.choices) &&
      data.equipment && typeof data.equipment === 'object' && !Array.isArray(data.equipment)) {
    return normalizeWowExportCharacter(data);
  }

  if (data && typeof data === 'object' && !Array.isArray(data) &&
      data.schema === 'wfa-armory-export-v1' && data.character && data.equipment) {
    const c = data.character;
    const items = {};
    for (const [slot, item] of Object.entries(data.equipment)) {
      if (!item || Number(item.item_id) <= 0) continue;
      const linkedName = String(item.item_link || '').match(/\|h\[([^\]]+)\]\|h/)?.[1] || '';
      items[slot] = {
        item_id: Number(item.item_id), slot_id: item.slot_id ?? null,
        icon: item.icon ?? item.icon_url ?? '',
        name: item.name ?? linkedName,
        quality: item.quality ?? item.item_quality ?? null,
        item_link: item.item_link ?? ''
      };
    }
    return {
      name: c.name || 'Персонаж WoW Forever',
      race: c.race_token || c.race || '',
      class: c.class_token || c.class || '',
      realm: c.realm || '', region: 'eu', level: c.level ?? null,
      faction: c.faction_name || c.faction || '', gear: { items },
      __wfaArmoryPilot: {
        character: c, equipment: data.equipment,
        client: data.client || {}, build: data.client?.build || ''
      }
    };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.name) {
    throw Error('Ответ не содержит имени персонажа. Проверьте формат JSON Raider.IO, WFA или wow.export v2.');
  }
  return data;
}

function shoulderSide(name) {
  const value = String(name || '').toLowerCase();
  if (/shoulder\s*\(?\s*l\s*\)?|shoulder.*left/.test(value)) return 'L';
  if (/shoulder\s*\(?\s*r\s*\)?|shoulder.*right/.test(value)) return 'R';
  return '';
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiplyMatrix(a, b) {
  const out = new Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function translationMatrix([x, y, z]) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function nodeLocalMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  const [x = 0, y = 0, z = 0, w = 1] = node.rotation || [];
  const [sx = 1, sy = 1, sz = 1] = node.scale || [];
  const [tx = 0, ty = 0, tz = 0] = node.translation || [];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1
  ];
}

function invertMatrix(a) {
  const out = new Array(16);
  const a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7];
  const a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
  const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10;
  const b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12;
  const b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30;
  const b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
  let determinant=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  determinant=1/determinant;
  out[0]=(a11*b11-a12*b10+a13*b09)*determinant; out[1]=(a02*b10-a01*b11-a03*b09)*determinant;
  out[2]=(a31*b05-a32*b04+a33*b03)*determinant; out[3]=(a22*b04-a21*b05-a23*b03)*determinant;
  out[4]=(a12*b08-a10*b11-a13*b07)*determinant; out[5]=(a00*b11-a02*b08+a03*b07)*determinant;
  out[6]=(a32*b02-a30*b05-a33*b01)*determinant; out[7]=(a20*b05-a22*b02+a23*b01)*determinant;
  out[8]=(a10*b10-a11*b08+a13*b06)*determinant; out[9]=(a01*b08-a00*b10-a03*b06)*determinant;
  out[10]=(a30*b04-a31*b02+a33*b00)*determinant; out[11]=(a21*b02-a20*b04-a23*b00)*determinant;
  out[12]=(a11*b07-a10*b09-a12*b06)*determinant; out[13]=(a00*b09-a01*b07+a02*b06)*determinant;
  out[14]=(a31*b01-a30*b03-a32*b00)*determinant; out[15]=(a20*b03-a21*b01+a22*b00)*determinant;
  return out;
}

function createWorldResolver(nodes) {
  const parents = new Map();
  nodes.forEach((node, parentIndex) => (node.children || []).forEach((child) => parents.set(child, parentIndex)));
  const cache = new Map();
  const world = (index, visiting = new Set()) => {
    if (cache.has(index)) return cache.get(index);
    if (visiting.has(index)) throw Error('Цикл в иерархии GLB');
    visiting.add(index);
    const parentIndex = parents.get(index);
    const local = nodeLocalMatrix(nodes[index]);
    const result = parentIndex === undefined ? local : multiplyMatrix(world(parentIndex, visiting), local);
    visiting.delete(index);
    cache.set(index, result);
    return result;
  };
  return { parents, world, clear: () => cache.clear() };
}

/** World matrix of the character model space: the skin's skeleton root, or the scene origin. */
function modelSpaceWorld(gltf, boneIndex, resolver) {
  const skin = (gltf.skins || []).find((entry) => (entry.joints || []).includes(boneIndex));
  return skin?.skeleton !== undefined ? resolver.world(skin.skeleton) : IDENTITY;
}

function validAttachment(attachment) {
  const position = attachment?.position;
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) return null;
  if (attachment.scale !== undefined && !(Number.isFinite(attachment.scale) && attachment.scale > 0)) return null;
  if (attachment.bone !== undefined && typeof attachment.bone !== 'string') return null;
  return attachment;
}

const attachmentBone = (attachment, side) => attachment?.bone || `bone_Shoulder${side}`;

/**
 * Shoulder attachments measured for wow.export 0.2.19 scourgefemale_hd with
 * Item 271754 (models shoulder_armor_skybornec60_d_01_l/_r): two OBJ exports in
 * different poses were matched against the item GLBs, and the posed arm bones
 * were recovered from the OBJ body. In both poses the item equals
 * bone_Arm{L|R} * T(position) * S(0.65) with no extra rotation (residual 1e-6);
 * position is the rest pivot of the shoulder-pad child bone of the arm, whose
 * constant scale track is 0.65. Values are character model space in GLB axes.
 */
export const CONFIRMED_SHOULDER_ATTACHMENTS = Object.freeze({
  scourgefemale_hd: Object.freeze({
    L: Object.freeze({ bone: 'bone_ArmL', position: Object.freeze([-0.029423, 1.647001, -0.146441]), scale: 0.65 }),
    R: Object.freeze({ bone: 'bone_ArmR', position: Object.freeze([-0.029423, 1.647, 0.146448]), scale: 0.65 })
  })
});

/**
 * wow.export 0.2.19 places an attachment model as
 *   characterModel * boneMatrix(animation) * T(M2Attachment.position) * itemVertex
 * (M2RendererGL.getAttachmentTransform). The attachment bone's own animation
 * can scale the item (0.65 for scourgefemale_hd), so a confirmed attachment is
 * { bone, position, scale } in rest-pose model space. Expressed relative to that
 * bone it keeps the in-game size and follows the bone when it animates.
 */
function attachmentLocalMatrix(modelWorld, boneWorld, attachment, itemLocal = IDENTITY) {
  const boneInverse = invertMatrix(boneWorld);
  if (!boneInverse) return null;
  const scale = attachment.scale ?? 1;
  const placement = multiplyMatrix(translationMatrix(attachment.position), [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]);
  return multiplyMatrix(boneInverse, multiplyMatrix(modelWorld, multiplyMatrix(placement, itemLocal)));
}

function readGlbHeader(file) {
  return file.slice(0, 20).arrayBuffer().then((buffer) => {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return null;
    const jsonLength = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength < 2 || jsonLength > 100 * 1024 * 1024 || 20 + jsonLength > file.size) return null;
    return jsonLength;
  });
}

function rewriteGlbJson(file, jsonLength, gltf) {
  const encoded = new TextEncoder().encode(JSON.stringify(gltf));
  const paddedLength = (encoded.length + 3) & ~3;
  const rewrittenChunk = new Uint8Array(20 + paddedLength);
  const totalLength = rewrittenChunk.length + file.size - (20 + jsonLength);
  const outputView = new DataView(rewrittenChunk.buffer);
  outputView.setUint32(0, 0x46546c67, true);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, totalLength, true);
  outputView.setUint32(12, paddedLength, true);
  outputView.setUint32(16, 0x4e4f534a, true);
  rewrittenChunk.fill(0x20, 20, 20 + paddedLength);
  rewrittenChunk.set(encoded, 20);
  return new Blob([rewrittenChunk, file.slice(20 + jsonLength)], { type: 'model/gltf-binary' });
}

/**
 * Parents wow.export shoulder meshes that were written at the scene origin
 * (GLB export keeps attachment items in raw item space, without the attachment
 * offset) to their attachment bones. `attachments` = { L: { bone, position, scale }, R: ... }
 * must come from confirmed data (CONFIRMED_SHOULDER_ATTACHMENTS or
 * deriveShoulderAttachments); sides without it are left untouched and reported
 * in `missing`.
 */
export async function attachDetachedShoulders(file, attachments = {}) {
  if (!file || file.size < 20) return { blob: file, attached: 0, missing: [] };
  const jsonLength = await readGlbHeader(file);
  if (jsonLength === null) return { blob: file, attached: 0, missing: [] };
  const gltf = JSON.parse(await file.slice(20, 20 + jsonLength).text());
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const skins = Array.isArray(gltf.skins) ? gltf.skins : [];
  const resolver = createWorldResolver(nodes);
  const jointNames = new Set(skins.flatMap((skin) => (skin.joints || []).map((index) => nodes[index]?.name)));
  const bones = new Map(nodes.map((node, index) => [node.name, index]));
  const missing = [];
  let attached = 0;

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.mesh === undefined || node.skin !== undefined) continue;
    const side = shoulderSide(node.name);
    if (!side) continue;
    const attachment = validAttachment(attachments[side]);
    const boneName = attachmentBone(attachment, side);
    const boneIndex = bones.get(boneName);
    if (boneIndex === undefined || !jointNames.has(boneName)) continue;
    if (resolver.parents.get(index) === boneIndex) continue;
    if (!attachment) {
      if (!missing.includes(side)) missing.push(side);
      continue;
    }

    const localToBone = attachmentLocalMatrix(modelSpaceWorld(gltf, boneIndex, resolver), resolver.world(boneIndex), attachment, nodeLocalMatrix(node));
    if (!localToBone) continue;
    const parentIndex = resolver.parents.get(index);
    if (parentIndex !== undefined) {
      nodes[parentIndex].children = (nodes[parentIndex].children || []).filter((child) => child !== index);
    } else {
      for (const scene of gltf.scenes || []) scene.nodes = (scene.nodes || []).filter((root) => root !== index);
    }
    nodes[boneIndex].children = nodes[boneIndex].children || [];
    if (!nodes[boneIndex].children.includes(index)) nodes[boneIndex].children.push(index);
    delete node.translation;
    delete node.rotation;
    delete node.scale;
    node.matrix = localToBone;
    resolver.parents.set(index, boneIndex);
    resolver.clear();
    attached++;
  }

  if (!attached) return { blob: file, attached: 0, missing };
  return { blob: rewriteGlbJson(file, jsonLength, gltf), attached, missing };
}

function readGlb(file) {
  return file.arrayBuffer().then((arrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) {
      throw Error('Файл не является корректным GLB 2.0');
    }
    let offset = 12;
    let document = null;
    let binary = null;
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + length > bytes.length) throw Error('GLB содержит повреждённый блок');
      if (type === 0x4e4f534a) document = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)).trim());
      if (type === 0x004e4942) binary = bytes.slice(start, start + length);
      offset = start + length;
    }
    if (!document || !binary || !Array.isArray(document.nodes) || !Array.isArray(document.meshes)) throw Error('В GLB нет сцены, мешей или бинарных данных');
    return { document, binary };
  });
}

function writeGlb(document, binary) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = (json.length + 3) & ~3;
  const binLength = (binary.length + 3) & ~3;
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, output.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength); output.set(json, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true); view.setUint32(binHeader + 4, 0x004e4942, true);
  output.set(binary, binHeader + 8);
  return new Blob([output], { type: 'model/gltf-binary' });
}

const COMPONENT_READERS = {
  5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'],
  5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32']
};
const COMPONENT_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(document, binary, index) {
  const accessor = document.accessors?.[index];
  const bufferView = document.bufferViews?.[accessor?.bufferView];
  const reader = COMPONENT_READERS[accessor?.componentType];
  const components = COMPONENT_COUNTS[accessor?.type];
  if (!accessor || !bufferView || !reader || !components) throw Error(`GLB: неподдерживаемый accessor ${index}`);
  const [size, method] = reader;
  const stride = bufferView.byteStride || size * components;
  const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const out = [];
  for (let item = 0; item < accessor.count; item++) {
    const row = [];
    for (let component = 0; component < components; component++) row.push(view[method](start + item * stride + component * size, true));
    out.push(components === 1 ? row[0] : row);
  }
  return out;
}

/** Item-space vertices (in index order) used by the given meshes of a GLB, with their first UV set. */
function itemVertices({ document, binary }, meshIndices = document.meshes.map((_, index) => index)) {
  const used = new Map();
  for (const primitive of meshIndices.flatMap((index) => document.meshes[index]?.primitives || [])) {
    const positions = readAccessor(document, binary, primitive.attributes.POSITION);
    const uvs = primitive.attributes.TEXCOORD_0 !== undefined ? readAccessor(document, binary, primitive.attributes.TEXCOORD_0) : [];
    const indices = primitive.indices !== undefined ? readAccessor(document, binary, primitive.indices) : positions.map((_, i) => i);
    for (const vertex of indices) used.set(vertex, { position: positions[vertex], uv: uvs[vertex] || null });
  }
  return [...used.keys()].sort((a, b) => a - b).map((vertex) => used.get(vertex));
}

/**
 * Reads the shoulder groups (`g Shoulder (L)_Item<id>_<n>`) of a wow.export
 * character OBJ exported with the item equipped. The OBJ writer emits only the
 * referenced vertices, in their original order, so each side yields the item's
 * vertices after wow.export applied the attachment transform.
 */
function objShoulderGroups(objText) {
  const positions = [];
  const uvs = [];
  const sides = {};
  let group = null;
  const resolve = (value, length) => {
    const index = Number.parseInt(value, 10);
    return index < 0 ? length + index : index - 1;
  };
  for (const raw of String(objText).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) positions.push(line.split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith('vt ')) uvs.push(line.split(/\s+/).slice(1, 3).map(Number));
    else if (line.startsWith('g ') || line.startsWith('o ')) {
      const name = line.slice(2).trim();
      const side = shoulderSide(name);
      const itemId = Number(name.match(/_Item(\d+)_/)?.[1]) || null;
      group = side ? (sides[side] ??= { itemId, vertices: new Map() }) : null;
      if (group && itemId && group.itemId && group.itemId !== itemId) throw Error(`OBJ: на стороне ${side} несколько предметов (${group.itemId}, ${itemId})`);
    } else if (line.startsWith('f ') && group) {
      for (const token of line.split(/\s+/).slice(1)) {
        const [v, vt] = token.split('/');
        const vertex = resolve(v, positions.length);
        group.vertices.set(vertex, vt ? resolve(vt, uvs.length) : null);
      }
    }
  }
  const result = {};
  for (const [side, entry] of Object.entries(sides)) {
    result[side] = {
      itemId: entry.itemId,
      vertices: [...entry.vertices.keys()].sort((a, b) => a - b).map((vertex) => ({
        position: positions[vertex],
        uv: entry.vertices.get(vertex) === null ? null : uvs[entry.vertices.get(vertex)]
      }))
    };
  }
  return result;
}

function solveLinear4(matrix, rhs) {
  const inverse = invertMatrix(matrix);
  if (!inverse) return null;
  return [0, 1, 2, 3].map((row) => inverse[row] * rhs[0] + inverse[4 + row] * rhs[1] + inverse[8 + row] * rhs[2] + inverse[12 + row] * rhs[3]);
}

/**
 * Least-squares affine fit reference = A * local + t over corresponding
 * vertices. In the rest pose wow.export's OBJ gives attached items
 * Ry(preview rotation) * T(attachment) (getAttachmentTransform applies the
 * preview's model_matrix, the baked body does not), so a rotation about the
 * vertical axis is stripped and reported. Any other rotation or scale means an
 * animation was applied and the reference cannot be used.
 */
function fitAttachment(local, reference, side) {
  if (local.length !== reference.length || local.length < 4) {
    throw Error(`Сторона ${side}: в эталонном OBJ ${reference.length} вершин наплечника, в GLB предмета ${local.length} — это разные модели или геосеты`);
  }
  const matched = (flip) => local.every((vertex, i) => !vertex.uv || !reference[i].uv ||
    (Math.abs(vertex.uv[0] - reference[i].uv[0]) < 1e-4 && Math.abs((flip ? 1 - vertex.uv[1] : vertex.uv[1]) - reference[i].uv[1]) < 1e-4));
  if (!matched(false) && !matched(true)) throw Error(`Сторона ${side}: UV вершин не совпадают — OBJ и GLB относятся к разным моделям`);

  const centroid = (list) => [0, 1, 2].map((axis) => list.reduce((sum, vertex) => sum + vertex.position[axis], 0) / list.length);
  const localCenter = centroid(local);
  const referenceCenter = centroid(reference);
  const normal = new Array(16).fill(0);
  const rhs = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  local.forEach((vertex, i) => {
    const a = [...vertex.position.map((value, axis) => value - localCenter[axis]), 1];
    const b = reference[i].position.map((value, axis) => value - referenceCenter[axis]);
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) normal[column * 4 + row] += a[row] * a[column];
      for (let axis = 0; axis < 3; axis++) rhs[axis][row] += a[row] * b[axis];
    }
  });
  const rows = rhs.map((b) => solveLinear4(normal, b));
  if (rows.some((row) => !row)) throw Error(`Сторона ${side}: вырожденная геометрия, трансформацию не определить`);
  const linear = rows.map((row) => row.slice(0, 3));
  const position = [0, 1, 2].map((axis) => referenceCenter[axis] + rows[axis][3] -
    linear[axis].reduce((sum, value, k) => sum + value * localCenter[k], 0));
  let squared = 0;
  local.forEach((vertex, i) => {
    for (let axis = 0; axis < 3; axis++) {
      const predicted = linear[axis].reduce((sum, value, k) => sum + value * vertex.position[k], 0) + position[axis];
      squared += (predicted - reference[i].position[axis]) ** 2;
    }
  });
  const rms = Math.sqrt(squared / local.length);
  const determinant = linear[0][0] * (linear[1][1] * linear[2][2] - linear[1][2] * linear[2][1]) -
    linear[0][1] * (linear[1][0] * linear[2][2] - linear[1][2] * linear[2][0]) +
    linear[0][2] * (linear[1][0] * linear[2][1] - linear[1][1] * linear[2][0]);
  const scale = Math.cbrt(determinant);
  const deviation = Math.max(...linear.flatMap((row, r) => row.map((value, c) => Math.abs(value - (r === c ? 1 : 0)))));
  if (rms > 1e-3) throw Error(`Сторона ${side}: вершины не совпадают ни при какой аффинной трансформации (RMS ${rms.toFixed(5)})`);
  if (deviation <= 1e-3) return { position, scale, rms, vertexCount: local.length, previewRotation: 0 };
  const yaw = Math.atan2(linear[0][2], linear[0][0]);
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const yawOnly = [[cos, 0, sin], [0, 1, 0], [-sin, 0, cos]];
  const yawDeviation = Math.max(...linear.flatMap((row, r) => row.map((value, c) => Math.abs(value - yawOnly[r][c]))));
  if (yawDeviation > 1e-3) {
    throw Error(`Сторона ${side}: эталон экспортирован не в позе покоя (масштаб ${scale.toFixed(4)}, отклонение матрицы ${deviation.toFixed(4)}). Экспортируйте OBJ с No Animation.`);
  }
  return {
    position: [cos * position[0] - sin * position[2], position[1], sin * position[0] + cos * position[2]],
    scale, rms, vertexCount: local.length, previewRotation: yaw * 180 / Math.PI
  };
}

/**
 * Derives the confirmed shoulder attachment points from a wow.export character
 * OBJ exported in the rest pose with shoulders equipped. The item-space
 * geometry comes either from the separately exported item GLBs ({ L, R }) or
 * from a GLB export of the same character with the same shoulders
 * ({ character }), where wow.export writes them unposed at the origin. The
 * attachment point belongs to the character model, so any shoulder item can
 * be used. Returns { L: { itemId, position, scale, rms, vertexCount }, R: ... }
 * in GLB coordinates (character model space).
 */
export async function deriveShoulderAttachments(objText, sources) {
  const groups = objShoulderGroups(objText);
  const character = sources?.character ? await readGlb(sources.character) : null;
  const result = {};
  for (const side of ['L', 'R']) {
    let local;
    if (character) {
      const meshes = character.document.nodes
        .filter((node) => node.mesh !== undefined && node.skin === undefined && shoulderSide(node.name) === side)
        .map((node) => node.mesh);
      if (!meshes.length) continue;
      local = itemVertices(character, meshes);
    } else if (sources?.[side]) {
      local = itemVertices(await readGlb(sources[side]));
    } else continue;
    if (!groups[side]) throw Error(`В эталонном OBJ нет группы наплечника ${side === 'L' ? 'Shoulder (L)' : 'Shoulder (R)'}`);
    result[side] = { itemId: groups[side].itemId, ...fitAttachment(local, groups[side].vertices, side) };
  }
  if (!Object.keys(result).length) throw Error('Не найдено ни одного наплечника для сравнения с OBJ');
  return result;
}

/**
 * Adds static wow.export item meshes to a character GLB and parents each mesh
 * to its matching shoulder joint. The source equipment GLBs have a one-bone
 * skin with an isolated skeleton; their geometry is already in local item
 * coordinates (bone_0 rests at its pivot, so its skin is the identity). We keep
 * geometry/materials 1:1 and place the item at its confirmed attachment
 * (`asset.attachment` = { bone, position, scale }, see
 * CONFIRMED_SHOULDER_ATTACHMENTS) under that bone, which then provides animation.
 */
export async function attachShoulderAssets(characterFile, assets) {
  const { document: base, binary: baseBinary } = await readGlb(characterFile);
  const nodes = base.nodes;
  const nodeByName = new Map(nodes.map((node, index) => [node.name, index]));
  const resolver = createWorldResolver(nodes);
  const buffers = [baseBinary];
  let binaryLength = baseBinary.length;
  base.buffers = base.buffers || [{ byteLength: binaryLength }];
  base.bufferViews = base.bufferViews || [];
  base.accessors = base.accessors || [];
  base.images = base.images || [];
  base.samplers = base.samplers || [];
  base.textures = base.textures || [];
  base.materials = base.materials || [];
  base.meshes = base.meshes || [];
  let attached = 0;

  for (const asset of assets || []) {
    const side = asset?.side === 'R' ? 'R' : asset?.side === 'L' ? 'L' : '';
    if (!side) throw Error('Для GLB наплечника не задана сторона L/R');
    const attachment = validAttachment(asset.attachment);
    if (!attachment) throw Error(`Для наплечника ${side} нет подтверждённой точки крепления (attachment.position)`);
    const boneName = attachmentBone(attachment, side);
    const boneIndex = nodeByName.get(boneName);
    if (boneIndex === undefined) throw Error(`В модели персонажа нет кости ${boneName}`);
    const matrix = attachmentLocalMatrix(modelSpaceWorld(base, boneIndex, resolver), resolver.world(boneIndex), attachment);
    if (!matrix) throw Error(`Кость ${boneName} имеет вырожденную трансформацию`);
    const source = await readGlb(asset.file);
    const src = source.document;
    const binaryOffset = (binaryLength + 3) & ~3;
    if (binaryOffset > binaryLength) buffers.push(new Uint8Array(binaryOffset - binaryLength));
    buffers.push(source.binary);
    binaryLength = binaryOffset + source.binary.length;

    const viewOffset = base.bufferViews.length;
    const accessorOffset = base.accessors.length;
    const samplerOffset = base.samplers.length;
    const textureOffset = base.textures.length;
    const materialOffset = base.materials.length;
    const meshOffset = base.meshes.length;
    for (const bufferView of src.bufferViews || []) {
      if (bufferView.buffer !== undefined && bufferView.buffer !== 0) throw Error('GLB модели наплечника использует неподдерживаемый внешний буфер');
      base.bufferViews.push({ ...bufferView, buffer: 0, byteOffset: binaryOffset + (bufferView.byteOffset || 0) });
    }
    for (const accessor of src.accessors || []) {
      base.accessors.push({ ...accessor, ...(accessor.bufferView !== undefined ? { bufferView: accessor.bufferView + viewOffset } : {}) });
    }
    for (const image of src.images || []) {
      if (image.bufferView !== undefined) base.images.push({ ...image, bufferView: image.bufferView + viewOffset });
      else if (image.uri) base.images.push({ ...image });
      else throw Error('У текстуры наплечника отсутствует источник изображения');
    }
    base.samplers.push(...(src.samplers || []).map((sampler) => ({ ...sampler })));
    base.textures.push(...(src.textures || []).map((texture) => ({
      ...texture,
      ...(texture.source !== undefined ? { source: texture.source + (base.images.length - (src.images || []).length) } : {}),
      ...(texture.sampler !== undefined ? { sampler: texture.sampler + samplerOffset } : {})
    })));
    const imageOffset = base.images.length - (src.images || []).length;
    for (let i = base.textures.length - (src.textures || []).length; i < base.textures.length; i++) {
      const texture = base.textures[i];
      const original = (src.textures || [])[i - textureOffset];
      if (original?.source !== undefined) texture.source = original.source + imageOffset;
    }
    base.materials.push(...(src.materials || []).map((material) => {
      const cloned = structuredClone(material);
      const remapTextures = (value) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, nested] of Object.entries(value)) {
          if (key.endsWith('Texture') && nested && Number.isInteger(nested.index)) nested.index += textureOffset;
          else remapTextures(nested);
        }
      };
      remapTextures(cloned);
      return cloned;
    }));
    const mesh = structuredClone(src.meshes[0]);
    for (const primitive of mesh.primitives || []) {
      const attributes = {};
      for (const [name, accessorIndex] of Object.entries(primitive.attributes || {})) {
        if (name === 'JOINTS_0' || name === 'WEIGHTS_0' || /^JOINTS_\d+$/.test(name) || /^WEIGHTS_\d+$/.test(name)) continue;
        attributes[name] = accessorIndex + accessorOffset;
      }
      primitive.attributes = attributes;
      if (primitive.indices !== undefined) primitive.indices += accessorOffset;
      if (primitive.material !== undefined) primitive.material += materialOffset;
    }
    base.meshes.push(mesh);
    const meshNodeIndex = nodes.length;
    nodes.push({ name: `WFArmory_${side}_Shoulder_${asset.name || 'test'}`, mesh: meshOffset, matrix });
    nodes[boneIndex].children = nodes[boneIndex].children || [];
    nodes[boneIndex].children.push(meshNodeIndex);
    attached++;
  }
  base.buffers[0] = { ...base.buffers[0], byteLength: binaryLength };
  if (base.buffers.length > 1) throw Error('Персонаж должен использовать один GLB BIN буфер');
  if (!attached) throw Error('Не выбраны модели наплечников');
  const bin = new Uint8Array(binaryLength);
  let offset = 0;
  for (const part of buffers) { bin.set(part, offset); offset += part.length; }
  return { blob: writeGlb(base, bin), attached };
}

if (typeof window !== 'undefined') {
  window.WFArmoryImport = { normalizeArmoryImport, attachDetachedShoulders, attachShoulderAssets, deriveShoulderAttachments, CONFIRMED_SHOULDER_ATTACHMENTS };
}

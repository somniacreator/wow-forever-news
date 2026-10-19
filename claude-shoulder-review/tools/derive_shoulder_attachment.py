"""Derive a character's shoulder attachments from two wow.export 0.2.19 OBJ exports.

wow.export writes an attached shoulder into a character OBJ as
    Ry(preview rotation) * B_arm(pose) * X * item_vertex,
while the baked body only gets the pose. This script:
  1. recovers B_arm for bone_ArmL/R from body vertices skinned 100% to that bone
     (rest positions and weights come from a skinned character GLB of the same
     export, e.g. one made with "Export animations");
  2. finds the two preview rotations for which X is identical in both OBJs
     (two different poses), and checks that the solution is exact;
  3. prints { bone, position, scale } for CONFIRMED_SHOULDER_ATTACHMENTS when X is
     a uniform scale plus translation.

Usage:
  python3 -I derive_shoulder_attachment.py CHARACTER.glb POSE1.obj POSE2.obj ITEM_L.glb ITEM_R.glb
"""
import json
import struct
import sys

import numpy as np


def load_glb(path):
    data = open(path, 'rb').read()
    json_length, = struct.unpack_from('<I', data, 12)
    document = json.loads(data[20:20 + json_length])
    offset = 20 + json_length
    bin_length, = struct.unpack_from('<I', data, offset)
    return document, data[offset + 8:offset + 8 + bin_length]


def accessor(document, binary, index):
    acc = document['accessors'][index]
    view = document['bufferViews'][acc['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    dtype = {5126: 'f4', 5125: 'u4', 5123: 'u2', 5121: 'u1'}[acc['componentType']]
    offset = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    values = np.frombuffer(binary, dtype=dtype, count=acc['count'] * width, offset=offset)
    return values.reshape(-1, width) if width > 1 else values


def read_obj(path):
    vertices, groups, current = [], {}, None
    for line in open(path):
        if line.startswith('v '):
            vertices.append([float(v) for v in line.split()[1:4]])
        elif line.startswith('g '):
            current = groups.setdefault(line[2:].strip(), set())
        elif line.startswith('f ') and current is not None:
            for token in line.split()[1:]:
                current.add(int(token.split('/')[0]) - 1)
    return np.array(vertices), groups


def affine_fit(source, target):
    design = np.hstack([source, np.ones((len(source), 1))])
    solution = np.linalg.lstsq(design, target, rcond=None)[0]
    rms = np.sqrt(((design @ solution - target) ** 2).sum(1).mean())
    matrix = np.eye(4)
    matrix[:3, :3] = solution[:3].T
    matrix[:3, 3] = solution[3]
    return matrix, rms


def yaw(degrees):
    t = np.radians(degrees)
    c, s = np.cos(t), np.sin(t)
    matrix = np.eye(4)
    matrix[:3, :3] = [[c, 0, s], [0, 1, 0], [-s, 0, c]]
    return matrix


def item_transforms(obj, items):
    vertices, groups = obj
    result = {}
    for side, path in items.items():
        document, binary = load_glb(path)
        primitive = document['meshes'][0]['primitives'][0]
        positions = accessor(document, binary, primitive['attributes']['POSITION']).astype(float)
        used = sorted(set(accessor(document, binary, primitive['indices']).tolist()))
        group = sorted(next(g for name, g in groups.items() if f'Shoulder ({side})' in name))
        if len(group) != len(used):
            sys.exit(f'{side}: OBJ has {len(group)} shoulder vertices, item GLB {len(used)}')
        result[side], rms = affine_fit(positions[used], vertices[group])
        if rms > 1e-5:
            sys.exit(f'{side}: item does not match the OBJ shoulder (rms {rms})')
    return result


def arm_matrices(document, binary, obj):
    vertices, groups = obj
    names = [node.get('name') for node in document['nodes']]
    joints = document['skins'][0]['joints']
    used = {}
    for node in document['nodes']:
        if 'mesh' not in node or 'skin' not in node:
            continue
        for primitive in document['meshes'][node['mesh']]['primitives']:
            attributes = primitive['attributes']
            positions = accessor(document, binary, attributes['POSITION'])
            joint_ids = accessor(document, binary, attributes['JOINTS_0'])
            weights = accessor(document, binary, attributes['WEIGHTS_0'])
            full = 255 if weights.dtype == np.uint8 else 0.999
            for index in set(accessor(document, binary, primitive['indices']).tolist()):
                used[index] = (positions[index], joint_ids[index][0], weights[index][0] >= full)
    keys = sorted(used)
    body = sorted(set().union(*[g for name, g in groups.items() if 'Shoulder' not in name]))
    if len(body) != len(keys):
        sys.exit(f'body vertex count differs: OBJ {len(body)}, GLB {len(keys)} (export both with the same appearance)')
    rest = np.array([used[k][0] for k in keys], float)
    posed = vertices[body]
    result = {}
    for side in 'LR':
        joint = joints.index(names.index(f'bone_Arm{side}'))
        rows = [i for i, k in enumerate(keys) if used[k][1] == joint and used[k][2]]
        matrix, rms = affine_fit(rest[rows], posed[rows])
        if len(rows) < 4 or rms > 1e-5:
            sys.exit(f'bone_Arm{side}: pose not recovered ({len(rows)} vertices, rms {rms})')
        result[side] = matrix
    return result


def main():
    character, obj_a, obj_b, item_l, item_r = sys.argv[1:6]
    document, binary = load_glb(character)
    items = {'L': item_l, 'R': item_r}
    poses = []
    for path in (obj_a, obj_b):
        obj = read_obj(path)
        poses.append((arm_matrices(document, binary, obj), item_transforms(obj, items)))
    (arm_a, item_a), (arm_b, item_b) = poses
    output = {}
    for side in 'LR':
        base = arm_a[side] @ np.linalg.inv(arm_b[side])
        best = None
        for yaw_b in np.arange(-180, 180, 0.01):
            k = base @ np.linalg.inv(yaw(yaw_b)) @ item_b[side] @ np.linalg.inv(item_a[side])
            yaw_a = np.degrees(np.arctan2(-k[0, 2], k[0, 0]))
            deviation = np.abs(k - np.linalg.inv(yaw(yaw_a))).max()
            if best is None or deviation < best[0]:
                best = (deviation, yaw_a, yaw_b)
        deviation, yaw_a, yaw_b = best
        x_a = np.linalg.inv(arm_a[side]) @ np.linalg.inv(yaw(yaw_a)) @ item_a[side]
        x_b = np.linalg.inv(arm_b[side]) @ np.linalg.inv(yaw(yaw_b)) @ item_b[side]
        scale = float(np.cbrt(np.linalg.det(x_a[:3, :3])))
        rotation_left = np.abs(x_a[:3, :3] / scale - np.eye(3)).max()
        print(f'{side}: preview yaw {yaw_a:.3f} / {yaw_b:.3f}, mismatch {deviation:.2e}, '
              f'X difference {np.abs(x_a - x_b).max():.2e}, scale {scale:.5f}, rotation residual {rotation_left:.2e}')
        if deviation > 1e-4 or np.abs(x_a - x_b).max() > 1e-4 or rotation_left > 1e-3:
            sys.exit(f'{side}: no exact rigid attachment to bone_Arm{side}')
        position = ((x_a + x_b) / 2)[:3, 3]
        output[side] = {'bone': f'bone_Arm{side}', 'position': [round(float(v), 6) for v in position], 'scale': round(scale, 4)}
    print(json.dumps(output))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Author and extract fixed tongue corrective shape keys in Blender 4.2.

The OBJ topology and vertex order remain pinned. Each key starts from the
representative jaw-coupled pose, receives a deterministic sculpt edit restricted
to an explicitly selected M_GumsTongue vertex group, and exports only the
correction delta. This script is an authoring/extraction aid, not runtime code.
"""
import bpy
import hashlib
import json
import math
import sys
from pathlib import Path

NEUTRAL = Path(sys.argv[-4]).resolve()
POSES = json.loads(Path(sys.argv[-3]).read_text())
OUT = Path(sys.argv[-2]).resolve()
REPORT = Path(sys.argv[-1]).resolve()


def read_obj(path):
    positions, faces = [], []
    material = None
    for line in path.read_text().splitlines():
        if line.startswith('v '):
            positions.append(tuple(float(x) for x in line.split()[1:4]))
        elif line.startswith('usemtl '):
            material = line.split(maxsplit=1)[1]
        elif line.startswith('f '):
            faces.append((material, [int(t.split('/')[0]) - 1 for t in line.split()[1:]]))
    return positions, faces

neutral, faces = read_obj(NEUTRAL)
neutral_sha = hashlib.sha256(NEUTRAL.read_bytes()).hexdigest()
verts_by_mat = {}
for mat, ids in faces:
    for index in ids:
        verts_by_mat.setdefault(index, set()).add(mat)
tongue = sorted(i for i, materials in verts_by_mat.items() if 'M_GumsTongue' in materials)
if not tongue:
    raise SystemExit('M_GumsTongue has no vertices')

# Explicit authoring groups in pinned source coordinates. The fixed-root band
# is excluded from every sculpt. The saved sparse output is the authored result.
def root_fixed(i):
    x, y, z = neutral[i]
    return y <= -5.0 or z <= 6.0 or abs(x) >= 1.55

def up_mask(i):
    x, y, z = neutral[i]
    return not root_fixed(i) and abs(x) < 1.35 and -4.9 < y < -2.7 and 6.4 < z < 9.9

def out_mask(i):
    x, y, z = neutral[i]
    return not root_fixed(i) and abs(x) < 1.25 and -5.0 < y < -3.45 and 7.4 < z < 10.15

def back_mask(i):
    x, y, z = neutral[i]
    return not root_fixed(i) and abs(x) < 1.45 and -4.65 < y < -2.45 and 6.15 < z < 8.55

masks = {
    'tongue_up': [i for i in tongue if up_mask(i)],
    'tongue_out': [i for i in tongue if out_mask(i)],
    'tongue_back': [i for i in tongue if back_mask(i)],
}
if any(len(indices) < 12 for indices in masks.values()):
    raise SystemExit(f'authored tongue groups unexpectedly small: { {k: len(v) for k, v in masks.items()} }')
authored_tongue_mask = sorted(set(masks['tongue_up']) | set(masks['tongue_out']) | set(masks['tongue_back']))

results = {}
for name, pose_spec in POSES.items():
    pose = [list(co) for co in neutral]
    for source in pose_spec['sources']:
        source_path = NEUTRAL.parent / source['file']
        source_positions, source_faces = read_obj(source_path)
        if len(source_positions) != len(neutral) or source_faces != faces:
            raise SystemExit(f'{name} representative pose changes topology/order')
        weight = float(source['weight'])
        for i, co in enumerate(source_positions):
            for axis in range(3):
                pose[i][axis] += (co[axis] - neutral[i][axis]) * weight
    pose = [tuple(co) for co in pose]
    mesh = bpy.data.meshes.new(f'tongue_authoring_{name}')
    mesh.from_pydata(pose, [], [ids for _, ids in faces])
    mesh.update()
    obj = bpy.data.objects.new(f'tongue_authoring_{name}', mesh)
    bpy.context.collection.objects.link(obj)
    basis = obj.shape_key_add(name='Basis')
    key = obj.shape_key_add(name=name)
    for i, co in enumerate(pose):
        basis.data[i].co = co
        key.data[i].co = co
    for i in masks[name]:
        x, y, z = pose[i]
        if name == 'tongue_up':
            strength = max(0.0, min(1.0, (z - 6.4) / 3.5))
            key.data[i].co.y += 0.24 * strength
            key.data[i].co.z += 0.035 * strength
        elif name == 'tongue_out':
            strength = max(0.0, min(1.0, (z - 7.4) / 2.7))
            key.data[i].co.z += 0.28 * strength
            key.data[i].co.y += 0.06 * strength
        else:
            strength = max(0.0, min(1.0, (8.55 - z) / 2.4))
            key.data[i].co.y += 0.18 * strength
            key.data[i].co.z -= 0.14 * strength
    rows, moved = [], set()
    for i in range(len(neutral)):
        delta = [key.data[i].co[j] - basis.data[i].co[j] for j in range(3)]
        if any(abs(c) > 1e-12 for c in delta):
            rows.append({'index': i, 'delta': [round(c, 9) for c in delta]})
            moved.add(i)
    if not moved.issubset(set(tongue)):
        raise SystemExit(f'{name} moves a non-tongue vertex')
    if any(root_fixed(i) for i in moved):
        raise SystemExit(f'{name} moves a fixed tongue root vertex')
    canonical_rows = ''.join(
        f"{row['index']}:{row['delta'][0]:.9f},{row['delta'][1]:.9f},{row['delta'][2]:.9f};"
        for row in rows
    )
    results[name] = {
        'pose_sources': pose_spec['sources'],
        'sha256': hashlib.sha256(canonical_rows.encode()).hexdigest(),
        'vertices': rows,
    }
    bpy.data.objects.remove(obj, do_unlink=True)

manifest = {
    'schema': 1,
    'source': './tools/asset-pipeline/.cache/generic_neutral_mesh.obj',
    'source_sha256': neutral_sha,
    'vertex_count': len(neutral),
    'blender_version': '.'.join(str(x) for x in bpy.app.version),
    'coordinate_convention': 'ICT OBJ xyz; source-space correction deltas transformed by build-bust normalisation/orientation',
    'tongue_material': 'M_GumsTongue',
    'tongue_vertex_mask': authored_tongue_mask,
    'fixed_root_rule': 'y <= -5.0 or z <= 6.0 or abs(x) >= 1.55',
    'targets': results,
}
OUT.write_text(json.dumps(manifest, indent=2) + '\n')
all_moved = {row['index'] for target in results.values() for row in target['vertices']}
gum_indices = {
    i for i, materials in verts_by_mat.items()
    if 'M_GumsTongue' in materials
    and (neutral[i][1] >= -2.7 or neutral[i][2] <= 6.0 or abs(neutral[i][0]) >= 1.55)
}
teeth_indices = {i for i, materials in verts_by_mat.items() if 'M_Teeth' in materials}
report = {
    'source_sha256': neutral_sha,
    'vertex_count': len(neutral),
    'blender_version': '.'.join(str(x) for x in bpy.app.version),
    'tongue_vertex_count': len(tongue),
    'target_moved_counts': {k: len(v['vertices']) for k, v in results.items()},
    'target_max_delta': {k: max(math.sqrt(sum(c * c for c in row['delta'])) for row in v['vertices']) for k, v in results.items()},
    'directional_mean_delta': {
        k: [sum(row['delta'][axis] for row in v['vertices']) / len(v['vertices']) for axis in range(3)]
        for k, v in results.items()
    },
    'fixed_root_verified': True,
    'non_tongue_verified': True,
    'gum_overlap_count': len(all_moved & gum_indices),
    'gum_max_delta': max((
        math.sqrt(sum(component * component for component in row['delta']))
        for target in results.values()
        for row in target['vertices']
        if row['index'] in gum_indices
    ), default=0.0),
    'teeth_overlap_count': len(all_moved & teeth_indices),
    'non_tongue_max_delta': 0.0,
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, sort_keys=True))

"""Fit wardrobe parts to the body on the shipped office GLBs.
Source of truth for the office look wardrobe since 2026-09-18 (build_*_catalog.py are history).
Blender --background --disable-autoexec --python-exit-code 1 --python tools/characters/wardrobe_fit.py -- --plans art/wardrobe-fit/plans.json [--noop] [ids...]

Requires Blender >= 4.4 (uses `action.slots` / `ad.action_slot`, the multi-action-slot animation API);
tested on 5.1.1.

Rerun from a clean checkout (`art/` and `docs/` are git-ignored and not shipped):
  1. Snapshot the source GLBs. They are exactly the office GLBs at commit 41ac7639 (the commit before this
     wardrobe-fit pass), byte for byte:
       mkdir -p art/wardrobe-fit/source
       for f in $(git ls-tree --name-only 41ac7639 public/assets/characters/office/); do
         git show 41ac7639:$f > art/wardrobe-fit/source/$(basename "$f")
       done
  2. Generate the plan (which nodes each look loses and which fitted templates it gains), from
     `src/game/three/office-looks.ts`:
       npx tsx tools/characters/wardrobe-plan.ts --json art/wardrobe-fit/plans.json
  3. Run in this order — each step's output is required by the next, and the audit's exit code is the gate:
       Blender --background --disable-autoexec --python-exit-code 1 \
         --python tools/characters/wardrobe_fit.py -- --plans art/wardrobe-fit/plans.json      # fit
       Blender --background --disable-autoexec --python-exit-code 1 \
         --python tools/characters/audit_wardrobe_fit.py -- --plans art/wardrobe-fit/plans.json  # audit (gate)
       Blender --background --disable-autoexec --python-exit-code 1 \
         --python tools/characters/review_wardrobe_angles.py --                                  # review sheets

`--plans`, like the audit, resolves a relative path against the repo root (`ROOT`, two parents up from this
file), not the process cwd, and defaults to `art/wardrobe-fit/plans.json` when omitted.
"""
import bpy, json, sys, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'art/wardrobe-fit/source'
OUT = ROOT / 'public/assets/characters/office'
BODY = re.compile(r'^(Human_Mesh|.+_(Top|LegsShoes|TrousersShoes))$')

def base(name): return re.sub(r'\.\d{3}$', '', name)

def bone_shapes(rig):
    """Objects used as pose-bone custom (display) shapes — the glTF importer's
    'Icosphere' bone-shape artifact, whose name gets locale-translated
    (e.g. Korean UI -> '아이코스피어') depending on the Blender preferences
    on disk, so we must find it structurally rather than by name."""
    return {pb.custom_shape.name for pb in rig.pose.bones if pb.custom_shape}

def load_source(ident):
    path = SRC / f'{ident}.glb'
    assert path.exists(), f'missing source snapshot {path}'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path), import_shading='SMOOTH')
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for name in bone_shapes(rig):
        o = bpy.data.objects.get(name)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
    norm = rig.parent
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    return {'id': ident, 'rig': rig, 'norm': norm,
            'body': [o for o in meshes if BODY.match(o.name)],
            'parts': {o.name: o for o in meshes if not BODY.match(o.name)},
            'mats': {m.name: m for m in bpy.data.materials}}

def remove_nodes(ctx, plan):
    wanted = set(plan['remove']); found = set(); gone = []
    for name, obj in list(ctx['parts'].items()):
        if base(name) in wanted:
            found.add(base(name)); gone.append(name)
            bpy.data.objects.remove(obj, do_unlink=True); del ctx['parts'][name]
    assert found == wanted, (ctx['id'], 'not found', sorted(wanted - found))
    return gone

def export(ctx, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_anim_single_armature=True,
        export_anim_slide_to_zero=True, export_skins=True,
        export_apply=False, export_yup=True, export_force_sampling=True)

def motion(rig):
    """World position of every bone head at the first, middle and last frame of each clip, each
    clip played alone — pins the clips' content, not just their frame ranges."""
    ad = rig.animation_data; scene = bpy.context.scene; out = {}
    for t in ad.nla_tracks: t.mute = True
    for act in sorted(bpy.data.actions, key=lambda a: a.name):
        ad.action = act; ad.action_slot = act.slots[0]; f0, f1 = (int(f) for f in act.frame_range)
        for f in (f0, (f0 + f1) // 2, f1):
            scene.frame_set(f + 1); scene.frame_set(f); bpy.context.view_layer.update()
            out[f'{act.name}@{f}'] = [tuple(rig.matrix_world @ b.head) for b in rig.pose.bones]
    return out

def contract(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path), import_shading='SMOOTH')
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    skip = bone_shapes(rig)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in skip]
    norm = rig.parent
    bpy.context.view_layer.update()
    body_meshes = [o for o in meshes if BODY.match(o.name)]
    xs = [(o.matrix_world @ v.co).x for o in body_meshes for v in o.data.vertices]
    ys = [(o.matrix_world @ v.co).y for o in body_meshes for v in o.data.vertices]
    zs = [(o.matrix_world @ v.co).z for o in body_meshes for v in o.data.vertices]
    return {'clips': {a.name: [round(a.frame_range[0]), round(a.frame_range[1])] for a in bpy.data.actions},
            'motion': motion(rig),
            'height': max(zs) - min(zs),
            'bounds': {'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)]},
            # bodyVerts stays BODY-only (also the body-surface/weight source later tasks fit
            # templates to — templates must not hug hair). meshVerts covers every exported
            # mesh node (body, hair, ties, badges, buttons, props, ...) so a vertex-count
            # regression anywhere is caught, not just on the body mesh.
            'bodyVerts': {o.name: len(o.data.vertices) for o in body_meshes},
            'meshVerts': {o.name: len(o.data.vertices) for o in meshes},
            'nodes': sorted(o.name for o in meshes),
            'normScale': tuple(round(c, 6) for c in norm.scale) if norm is not None else None}

def contract_problems(ident, before, after, removed):
    """Every way `after` (the fitted GLB's contract) breaks the source's `before`; [] when it holds.
    `removed` is the plan's removed base names (empty under --noop)."""
    bad = []
    def need(ok, *why):
        if not ok: bad.append((ident, *why))
    need(after['clips'] == before['clips'], 'clips changed', before['clips'], after['clips'])
    need(after['motion'].keys() == before['motion'].keys(), 'clip frames changed')
    if after['motion'].keys() == before['motion'].keys():
        drift = max(max(abs(p - q) for u, v in zip(before['motion'][k], after['motion'][k]) for p, q in zip(u, v))
                    for k in before['motion'])
        need(drift < 1e-3, 'clip poses changed (a rig left in REST exports frozen clips)', drift)
    need(abs(after['height'] - before['height']) / before['height'] < .01, 'height', before['height'], after['height'])
    need(after['bodyVerts'] == before['bodyVerts'], 'body mesh changed')
    need(after['normScale'] == before['normScale'], 'normScale', before['normScale'], after['normScale'])
    # PRESERVED check: every mesh node not removed by the plan (base name, .NNN stripped) keeps its
    # exact vertex count — body, hair, ties, badges, buttons, props, everything meshVerts sees.
    for name, count in before['meshVerts'].items():
        if base(name) in removed: continue
        need(after['meshVerts'].get(name) == count, name, 'vertex count changed', count, after['meshVerts'].get(name))
    extra = set(after['meshVerts']) - set(before['meshVerts'])
    need(all(n.startswith(f'{ident}_Fit_') for n in extra), 'unexpected new mesh nodes', sorted(extra))
    expected_nodes = sorted([n for n in before['nodes'] if base(n) not in removed] + sorted(extra))
    need(after['nodes'] == expected_nodes, 'node names changed', before['nodes'], after['nodes'])
    # Floor-origin + facing/build-shape guard: BODY bounds must not drift. min z pins the floor
    # origin (1mm); all six bounds pin build width/depth/height and thus facing (1% of height).
    need(abs(after['bounds']['min'][2] - before['bounds']['min'][2]) < .001, 'floor origin drifted',
         before['bounds']['min'][2], after['bounds']['min'][2])
    tol = before['height'] * .01
    for axis, i in (('x', 0), ('y', 1), ('z', 2)):
        for bound in ('min', 'max'):
            b, a = before['bounds'][bound][i], after['bounds'][bound][i]
            need(abs(a - b) < tol, bound, axis, 'bounds drifted', b, a)
    return bad

def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    plans_path = Path(argv[argv.index('--plans') + 1]) if '--plans' in argv else ROOT / 'art/wardrobe-fit/plans.json'
    if not plans_path.is_absolute(): plans_path = ROOT / plans_path
    plans = {p['id']: p for p in json.loads(plans_path.read_text())}
    noop = '--noop' in argv
    ids = [a for a in argv if a.startswith('office-')] or sorted(plans)
    for ident in ids:
        src_path = SRC / f'{ident}.glb'
        assert src_path.exists(), f'missing source snapshot {src_path}'
        before = contract(src_path)
        ctx = load_source(ident)
        if not noop:
            remove_nodes(ctx, plans[ident])
            if plans[ident]['skirt']:   # first, so bags and hems fit on the final skirt
                from wardrobe_templates import fix_skirt_hem   # local: wardrobe_templates needs the sys.path
                fix_skirt_hem(ctx, plans[ident]['skirt'])       # patch done in __main__ below, not on plain import
            from wardrobe_templates import apply_templates
            apply_templates(ctx, plans[ident])
        export(ctx, OUT / f'{ident}.glb')
        after = contract(OUT / f'{ident}.glb')
        removed = set(plans[ident]['remove']) if not noop else set()
        problems = contract_problems(ident, before, after, removed)
        assert not problems, problems
        before_bytes = (SRC / f'{ident}.glb').stat().st_size
        after_bytes = (OUT / f'{ident}.glb').stat().st_size
        print('FIT PASS', ident, 'bytes', before_bytes, '->', after_bytes, flush=True)

if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()

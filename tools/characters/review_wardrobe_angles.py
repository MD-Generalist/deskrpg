"""Before/after review sheets for fitted wardrobe looks: the source snapshot over the shipped GLB, 9 views each.
Blender --background --disable-autoexec --python-exit-code 1 --python tools/characters/review_wardrobe_angles.py -- [ids...]
-> art/wardrobe-fit/review/{id}-compare.jpg (2 rows x 9 columns, labelled) and the single frames in review/frames/.
Needs ImageMagick (`montage`) on PATH.

Views (spec §4.4): front, 3/4, side, rear, rear 3/4, game camera, upper-body close-up — rest of idle frame 0 —
plus walk at mid-clip from the front and sit at mid-clip from 3/4. Cameras aim from the posed shoulders, so
both rigs (male faces +X at rest, both face -Y in the clips) are framed the same way.
"""
import bpy, math, shutil, subprocess, sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'art/wardrobe-fit/source'
OUT = ROOT / 'public/assets/characters/office'
REVIEW = ROOT / 'art/wardrobe-fit/review'
W, H = 360, 560            # every panel (portrait); the sheet shows them at PANEL
PANEL = '270x420+3+3'
# (name, label, clip, fraction of the clip, camera angle from the front toward the character's left (deg),
#  camera height, aim height, ortho scale). Negative angles swing to the character's right.
VIEWS = [
    ('front', 'front', 'idle', 0, 0, 1.4, .95, 2.1),
    ('q3', '3/4', 'idle', 0, -40, 1.4, .95, 2.1),
    ('side', 'side', 'idle', 0, 90, 1.4, .95, 2.1),
    ('rear', 'rear', 'idle', 0, 180, 1.4, .95, 2.1),
    ('q3rear', 'rear 3/4', 'idle', 0, -140, 1.4, .95, 2.1),
    ('game', 'game camera', 'idle', 0, -40, 5.0, .9, 2.1),
    ('upper', 'upper body', 'idle', 0, -20, None, None, .8),
    ('walk', 'walk mid, front', 'walk', .5, 0, 1.4, .95, 2.1),
    ('sit', 'sit mid, 3/4', 'sit', .5, -40, 1.4, .8, 2.1),
]


def aim(o, p): o.rotation_euler = (Vector(p) - o.location).to_track_quat('-Z', 'Y').to_euler()


def pose(rig, clip, frac):
    act = bpy.data.actions[clip]; ad = rig.animation_data; ad.action = act; ad.action_slot = act.slots[0]
    f0, f1 = act.frame_range; f = int(f0 + (f1 - f0) * frac)
    bpy.context.scene.frame_set(f + 1); bpy.context.scene.frame_set(f); bpy.context.view_layer.update()


def facing(rig):
    """(fwd, left) in the current pose, from the shoulders."""
    L, R = ('LeftShoulder', 'RightShoulder') if 'Human' in rig.name else ('Shoulder.L', 'Shoulder.R')
    m = rig.matrix_world; left = (m @ rig.pose.bones[L].tail) - (m @ rig.pose.bones[R].tail); left.z = 0; left.normalize()
    return left.cross(Vector((0, 0, 1))).normalized(), left


def render(glb_path, out_prefix, views=VIEWS):
    """Render `views` of one GLB to `{out_prefix}-{view}.png`; returns the paths in view order."""
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=str(glb_path))
    s = bpy.context.scene; rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for pb in rig.pose.bones:
        if pb.custom_shape: pb.custom_shape.hide_render = True   # the importer's bone-shape spheres
    for t in rig.animation_data.nla_tracks: t.mute = True        # each clip alone, as the game plays it
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    s.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    s.view_settings.view_transform = 'Standard'; s.render.resolution_x, s.render.resolution_y = W, H
    s.world = bpy.data.worlds.new('review'); s.world.color = (.5, .5, .5)
    pose(rig, 'idle', 0); fwd, left = facing(rig)
    def around(ang): r = math.radians(ang); return fwd * math.cos(r) + left * math.sin(r)
    for d, h, p in ((around(-40) * 5, 5, 600), (around(60) * 3, 3, 300), (around(180) * 4, 4, 400)):
        bpy.ops.object.light_add(type='AREA', location=d + Vector((0, 0, h))); o = bpy.context.object
        o.data.energy = p; o.data.size = 4; aim(o, (0, 0, 1))
    bpy.ops.object.camera_add(); cam = bpy.context.object; cam.data.type = 'ORTHO'; s.camera = cam
    paths = []
    for name, _, clip, frac, ang, h, tz, scale in views:
        pose(rig, clip, frac); fwd, left = facing(rig)
        if h is None:   # close-up: centred on the chest below the neck, whatever the build
            nk = rig.matrix_world @ rig.pose.bones['Neck'].head; tgt = Vector((nk.x, nk.y, nk.z - .2))
            cam.location = tgt + around(ang) * 6
        else:
            tgt = Vector((0, 0, tz)); cam.location = around(ang) * (4.6 if name == 'game' else 6) + Vector((0, 0, h))
        cam.data.ortho_scale = scale; aim(cam, tgt)
        s.render.filepath = str(Path(f'{out_prefix}-{name}.png')); bpy.ops.render.render(write_still=True)
        paths.append(Path(f'{out_prefix}-{name}.png'))
    return paths


def sheet(ident, before, after):
    """2 x 9 labelled sheet: source above, fitted below."""
    assert shutil.which('montage'), 'ImageMagick montage is required'
    args = ['montage']
    for row, paths in (('BEFORE', before), ('AFTER', after)):
        for (_, label, *_), p in zip(VIEWS, paths): args += ['-label', f'{row} · {label}', str(p)]
    dest = REVIEW / f'{ident}-compare.jpg'
    args += ['-tile', f'{len(VIEWS)}x2', '-geometry', PANEL, '-pointsize', '16', '-background', '#e8e8e8',
             '-title', f'{ident}   top: source snapshot   bottom: fitted (shipped GLB)', '-quality', '88', str(dest)]
    subprocess.run(args, check=True)
    return dest


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ids = [a for a in argv if a.startswith('office-')] or sorted(p.stem for p in OUT.glob('*.glb'))
    frames = REVIEW / 'frames'; frames.mkdir(parents=True, exist_ok=True)
    for ident in ids:
        before = render(SRC / f'{ident}.glb', frames / f'{ident}-before')
        after = render(OUT / f'{ident}.glb', frames / f'{ident}-after')
        print('REVIEW', ident, sheet(ident, before, after), flush=True)


if __name__ == '__main__':
    main()

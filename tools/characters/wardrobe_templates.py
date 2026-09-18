"""Fitted wardrobe templates. Proportions are relative to measured landmarks so both bodies and every build fit.

Every template builds in rest pose, world space, from rays cast onto the body, then joins its
pieces into one node named `${id}_Fit_${template}` that is skinned from the body's weights.
Directions come from landmarks()['fwd'] / ['left'] — never from hard-coded world axes.
"""
import math
import bpy
from mathutils import Vector
import functools, re
from wardrobe_geometry import (body_bvh, landmarks, surface_point, surface_from_inside, layered_from_inside, hull_loop,
                               ribbon, tube, plate, pillow, push_out, finish, bone_name, rest_points, standoff, resample, pose_clearance, pose_clearance_many, link, UP,
                               shell_weights, FOLLOW_REACH)


def material(ctx, role):
    male = 'Human' in ctx['rig'].name; i = ctx['id']
    names = {'coat': 'coat' if male else f'{i}_Jacket', 'shirt': 'shirt' if male else f'{i}_Shirt',
             'strap': 'shoes' if male else f'{i}_Shoes', 'bag': 'shoes' if male else f'{i}_Shoes'}
    return ctx['mats'][names[role]]


def neck_axis(bvh, lm, height):
    """Point on the neck's own centre line at `height` (0 = neck bone head, 1 = tail).
    The bone may sit off the neck's centre, so re-centre it from a ring of hits."""
    head, tail = lm['neck']; c = head.lerp(tail, height)
    hits = [surface_from_inside(bvh, c, _around(lm, k / 8 * math.tau), 0)[0] for k in range(8)]
    centre = sum(hits, Vector()) / len(hits); centre.z = c.z
    return centre


def _around(lm, a):
    """Horizontal unit vector at angle `a` around the body; 0 = front, tau/4 = character left."""
    return lm['fwd'] * math.cos(a) + lm['left'] * math.sin(a)


def neck_ring(bvh, lm, height, offset, samples=16, outer=None):
    """Closed loop of (point, normal) hugging the neck at `height`. Below the neck column the
    same rays land on the shoulder slope, so a low ring rests on the shoulders like a real wrap.
    Garments in `outer` (a jacket collar) count as surface."""
    c = neck_axis(bvh, lm, height); pts = []; nrm = []
    for k in range(samples):
        d = _around(lm, k / samples * math.tau)
        p, n = surface_from_inside(bvh, c, d, offset) if outer is None else layered_from_inside(bvh, outer, c, d, offset)
        pts.append(p); nrm.append(n)
    return pts, nrm


def throat(bvh, lm, drop, offset):
    """Point on the front of the body `drop` below the neck bone head, and the surface normal there."""
    return surface_point(bvh, lm['neck'][0] - UP * drop, lm['fwd'], offset)


def drape(bvh, lm, start, side, length, spread, offset, steps=5):
    """Points running down the front of the body from `start`, drifting `spread` sideways."""
    pts, nrm = [], []
    for t in range(steps):
        u = t / (steps - 1)
        q = start + lm['left'] * (side * spread * u) - UP * (length * u)
        p, n = surface_point(bvh, q, lm['fwd'], offset); pts.append(p); nrm.append(n)
    return pts, nrm


def over(cloud, pts, nrm, lift, radius):
    """Points placed `lift` above a surface along their normals, raised further wherever a point
    of `cloud` (the layers they lie on) stands higher within `radius` of the normal line — a
    lapel's rim, a collar's top edge. No cloud (nothing layered underneath): unchanged."""
    if cloud is None: return pts
    out = []
    for p, n in zip(pts, nrm):
        b = p - n * lift; out.append(b + n * (max(0.0, standoff(cloud, b, n, radius, .05)) + lift))
    return out


def _tube_rows(obj, dirs, sides=8):
    """Rows of a tube(): ring k is vertices k*sides .. k*sides+sides-1, lifted along dirs[k]."""
    assert len(obj.data.vertices) == len(dirs) * sides, (obj.name, 'unexpected tube topology')
    return (obj, [list(range(k * sides, (k + 1) * sides)) for k in range(len(dirs))], list(dirs))


def _ribbon_rows(obj, dirs):
    """Rows of a solidified ribbon(): point k owns 2k, 2k+1 and their offset twins."""
    n = len(dirs) * 2; assert len(obj.data.vertices) == 2 * n, (obj.name, 'unexpected ribbon topology')
    return (obj, [[2 * k, 2 * k + 1, n + 2 * k, n + 2 * k + 1] for k in range(len(dirs))], list(dirs))


def _clear_over_layers(ctx, pieces, cloud, name):
    """Neckwear over chest layers: lift its rows off body and layers in every clip frame, as the
    layers themselves are (triangulated first, as exported). Nothing to do without layers."""
    if cloud is None: return
    import bmesh
    for obj, _, _ in pieces:
        bm = bmesh.new(); bm.from_mesh(obj.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(obj.data); bm.free()
        # glTF keeps 4 joints per vertex: check the skinning that ships (see finish max_influences)
        bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = obj; obj.select_set(True)
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False); obj.select_set(False)
    left = pose_clearance_many(ctx, pieces, LAYER_MARGIN, others=layer_parts(ctx, FIT_LAYER))
    assert left < .001, (ctx['id'], name, 'still pierced over layers', left)


def _layer_cloud(ctx, lm, outer):
    """Rest-pose vertices of the chest layers (not the body: the chin over the throat would
    count) near the neck, or None without layers."""
    if outer is None: return None
    return _near(rest_points(ctx, layer_parts(ctx)), lm['neck'][0], .4)


def scarf(ctx, bvh, lm):
    """Rolled band wrapped twice around the neck, a small knot at the throat and two short tails."""
    mat = material(ctx, 'coat'); i = ctx['id']; left = lm['left']
    outer, dressed = layer_bvh(ctx)   # lies over lapels and a jacket collar
    cloud = _layer_cloud(ctx, lm, outer)
    rolls = []; rows = []
    for height, r in SCARF['rolls']:
        pts, nrm = neck_ring(bvh, lm, height, r + SCARF['band_offset'], outer=outer)
        pts = over(cloud, pts, nrm, r + SCARF['band_offset'], r * 1.2)
        rolls.append(finish(ctx, tube(f'{i}_Fit_scarf.roll', pts, r, 8, closed=True), mat, 0)); rows.append(_tube_rows(rolls[-1], nrm))
    k, kn = throat(dressed, lm, SCARF['knot_drop'], SCARF['knot_r'] * .8)
    k = over(cloud, [k], [kn], SCARF['knot_r'] * .8, SCARF['knot_r'] * 1.2)[0]
    k_axis = (UP - kn * UP.dot(kn)).normalized()   # knot lies along the throat slope
    knot = finish(ctx, tube(f'{i}_Fit_scarf.knot', [k + k_axis * SCARF['knot_len'] / 2, k - k_axis * SCARF['knot_len'] / 2],
                            SCARF['knot_r'], 8), mat, 0)
    rows.append(_tube_rows(knot, [kn, kn]))
    tails = []
    for s, length in ((1, SCARF['tail_len']), (-1, SCARF['tail_len'] * .8)):
        start = k - k_axis * SCARF['knot_len'] * .3 + left * s * SCARF['tail_gap']
        tp, tn = drape(dressed, lm, start, s, length, SCARF['tail_spread'], SCARF['tail_offset'])
        tp = over(cloud, tp, tn, SCARF['tail_offset'], SCARF['tail_width'] * .6)
        tails.append(finish(ctx, ribbon(f'{i}_Fit_scarf.tail', tp, SCARF['tail_width'], tn), mat, SCARF['thick']))
        rows.append(_ribbon_rows(tails[-1], tn))
    _clear_over_layers(ctx, rows, cloud, f'{i}_Fit_scarf')
    return join(bvh, [*rolls, knot, *tails], f'{i}_Fit_scarf')   # body only: a thin lapel shell would pull vertices under it


def bow(ctx, bvh, lm):
    """Small blouse bow at the throat: two pinched wings, a knot and two short tails."""
    mat = material(ctx, 'coat'); i = ctx['id']; left = lm['left']
    outer, dressed = layer_bvh(ctx)   # lies over lapels
    cloud = _layer_cloud(ctx, lm, outer)
    c, n = throat(dressed, lm, BOW['drop'], BOW['lift'])
    c = over(cloud, [c], [n], BOW['lift'], BOW['wing_w'])[0]
    face = (n + lm['fwd']).normalized()             # half-way between the slope and straight ahead
    up = face.cross(left).normalized()              # in-plane vertical
    wings = []
    for s in (-1, 1):
        w, h = BOW['wing_w'], BOW['wing_h']; outline = []
        for k in range(BOW['wing_segments'] + 1):
            a = -math.pi / 2 + k / BOW['wing_segments'] * math.pi     # outer rounded edge, bottom to top
            outline.append(c + left * s * (w * (.55 + .45 * math.cos(a))) + up * (h / 2 * math.sin(a)))
        outline += [c + left * s * w * .12 + up * h * .14, c + left * s * w * .12 - up * h * .14]   # pinch at the knot
        if s < 0: outline.reverse()
        wings.append(finish(ctx, plate(f'{i}_Fit_bow.wing', outline, face, BOW['thick']), mat, 0))
    knot = finish(ctx, tube(f'{i}_Fit_bow.knot', [c + up * BOW['knot_r'] * 1.1, c - up * BOW['knot_r'] * 1.1],
                            BOW['knot_r'], 8), mat, 0)
    rows = [(w, [list(range(len(w.data.vertices)))], [face]) for w in wings] + [_tube_rows(knot, [face, face])]
    tails = []
    for s in (-1, 1):
        tp, tn = drape(dressed, lm, c - up * BOW['knot_r'] + left * s * BOW['knot_r'] * .6, s,
                       BOW['tail_len'], BOW['tail_spread'], BOW['tail_offset'], steps=4)
        tp = over(cloud, tp, tn, BOW['tail_offset'], BOW['tail_width'] * .6)
        tails.append(finish(ctx, ribbon(f'{i}_Fit_bow.tail', tp, BOW['tail_width'], tn), mat, BOW['tail_thick']))
        rows.append(_ribbon_rows(tails[-1], tn))
    _clear_over_layers(ctx, rows, cloud, f'{i}_Fit_bow')
    return join(bvh, [*wings, knot, *tails], f'{i}_Fit_bow')


# Tuned on office-daeun / office-garam renders (metres, rest pose).
SCARF = {'rolls': ((.15, .016), (-.15, .018)), 'band_offset': .002, 'thick': .012,
         'knot_drop': .035, 'knot_r': .022, 'knot_len': .032,
         'tail_len': .11, 'tail_width': .046, 'tail_spread': .03, 'tail_gap': .012, 'tail_offset': .006}
BOW = {'drop': .045, 'lift': .012, 'wing_w': .055, 'wing_h': .046, 'wing_segments': 6, 'thick': .012,
       'knot_r': .011, 'tail_len': .075, 'tail_spread': .018, 'tail_width': .020, 'tail_offset': .006,
       'tail_thick': .006}
GAP = .003   # final clearance above the body surface for every vertex


def join(bvh, objs, name, push=True):
    import bpy
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join()
    obj = objs[0]; obj.name = name; obj.data.name = name
    obj.select_set(False)
    assert obj.name == name, ('name collision', name, obj.name)
    if push: push_out(bvh, obj, GAP)
    return obj


# ---------------------------------------------------------------- bags
# Garments that lie on the body and that bag straps / bag bodies must rest on, not sink into.
OUTER = re.compile(r'((Skirt|CoatHem|Hood|Hood down|Vest)(\.\d{3})?|_Fit_(shirt_v|shirt_collar|vest_v|lapel))$')


def outer_parts(ctx):
    return [o for n, o in ctx['parts'].items() if OUTER.search(n)]


def outer_bvh(ctx):
    """(outer layer alone or None, body + outer layer) — the first for layered_from_inside, the
    second for rays cast from outside, where the first hit is already the outermost layer."""
    objs = outer_parts(ctx)
    if not objs: return None, body_bvh(ctx)
    return body_bvh(ctx, objs), body_bvh(ctx, [*ctx['body'], *objs])


def push_surface(ctx, dressed):
    """Surface for a bag's final push_out: `dressed` without the chest layers. Straps are cleared
    over those layers in every frame (_cleared); a per-vertex push onto a thin lapel shell would
    move single strap vertices back into it."""
    objs = outer_parts(ctx); keep = [o for o in objs if not FIT_LAYER.search(o.name)]
    return dressed if len(keep) == len(objs) else body_bvh(ctx, [*ctx['body'], *keep])


def pelvis(lm, z):
    """Point on the pelvis centre line at height z (between the hip joints)."""
    c = (lm['upleg.L'][0] + lm['upleg.R'][0]) / 2; c.z = z; return c


def hip_axis(lm, side, z):
    """Inside point for rays around the hip at height z. Above the hip joints it is the pelvis
    centre; lower down that centre falls between the legs, so it slides onto the `side` thigh."""
    h, t = lm['upleg.L' if side > 0 else 'upleg.R']; c = pelvis(lm, z)
    w = max(0.0, min(1.0, (h.z + .01 - z) / .06))
    leg = h.lerp(t, max(0.0, (h.z - z) / (h.z - t.z))); leg.z = z
    return c.lerp(leg, w)


def _skin_table(ctx):
    """(rest positions (N, 3), weights (N, bones), bone names) of every body vertex, cached on ctx."""
    import numpy as np
    if '_skin' not in ctx:
        bones = [b.name for b in ctx['rig'].data.bones]; col = {n: k for k, n in enumerate(bones)}; P = []; W = []
        for o in ctx['body']:
            names = {g.index: g.name for g in o.vertex_groups}; mw = o.matrix_world
            for v in o.data.vertices:
                P.append(tuple(mw @ v.co)); row = [0.0] * len(bones)
                for g in v.groups:
                    if names[g.group] in col: row[col[names[g.group]]] += g.weight
                W.append(row)
        ctx['_skin'] = (np.array(P), np.array(W), bones)
    return ctx['_skin']


def skin_blend(ctx, p, radius, fallback):
    """Averaged skin weights of the body around rest-pose point `p` (at most 4 bones, none under 3 %), so
    a bag moves with the skin it rests on. Widens the search where no skin is near (under a
    skirt the hip has no skin mesh) and falls back to `fallback` only if nothing is found."""
    import numpy as np
    P, W, bones = _skin_table(ctx)
    for r in (radius, radius * 2, radius * 4):
        tot = np.clip(1 - np.sqrt(((P - np.array(p)) ** 2).sum(1)) / r, 0, None) @ W
        if tot.sum() > 0: break
    else:
        return {fallback: 1.0}
    top = sorted(((w, bones[k]) for k, w in enumerate(tot) if w / tot.sum() >= .03), reverse=True)[:4]   # glTF: 4 joints
    k = sum(w for w, _ in top); return {b: w / k for w, b in top}


def skin_under(ctx, dressed, out, radius, fallback):
    """Per-vertex binding for a bag body: each vertex takes the skin weights at its foot point on
    the dressed surface (cast back along -out), so front and back of the pillow follow the skin
    under them in every pose instead of floating off it as a rigid block."""
    def weights(co):
        hit, _, _, _ = dressed.ray_cast(co + out * .3, -out, .6)
        return skin_blend(ctx, hit if hit is not None else co, radius, fallback)
    return weights


def hand_prop_side(ctx):
    """+1 if the look holds a hand prop in its left hand, -1 for the right, 0 for none."""
    b = ctx['rig'].data.bones.get('OfficeHandProp')
    if b is None or not any('Hand' in n or 'Notebook' in n for n in ctx['parts']): return 0
    while b is not None:
        if b.name.startswith('Left') or b.name.endswith('.L'): return 1
        if b.name.startswith('Right') or b.name.endswith('.R'): return -1
        b = b.parent
    return 0


def shoulder_top(bvh, outer, lm, side):
    """Top of the shoulder (trapezius) on `side` (+1 = character left), reached from inside."""
    h, t = lm['shoulder.L' if side > 0 else 'shoulder.R']
    return layered_from_inside(bvh, outer, h.lerp(t, BACKPACK['strap_along']), UP, 0)[0]


STRAP_MARGIN = .0015   # clearance a strap keeps over the skin in every clip frame


def _onto_surface(dressed, pts, nrm, gap):
    """Strap points that a straight run (bag corner to the band, resampled) left inside the dressed
    body are put back on its surface, `gap` above the nearest face. Hidden inside the hips they read
    as fine in renders but are a part sunk under the skin, and a clip-frame lift can only push them
    straight out (jun: a 33 cm spike)."""
    out_p, out_n = [], []
    for q, n in zip(pts, nrm):
        loc, fn, _, _ = dressed.find_nearest(q)
        if loc is not None and (q - loc).dot(fn) < gap: q, n = loc + fn * gap, fn
        out_p.append(q); out_n.append(n)
    return out_p, out_n


def _cleared_bag(ctx, pieces, name):
    """Bag body with its pocket/handle/flap: one shared weight set (shell_weights, solved over the
    contact face), joined into one shell, and in any clip frame where skin pierces the shell or the
    shell sinks under the skin the whole shell is lifted (one row), never single vertices — a bag
    moves and stays shaped as one piece."""
    import bmesh
    skin = body_bvh(ctx); mw = pieces[0].matrix_world
    on = body_bvh(ctx, [*ctx['body'], *outer_parts(ctx)])   # what the bag lies on: skin, or a coat hem / skirt over it
    contact = [mw @ v.co for v in pieces[0].data.vertices if on.find_nearest(mw @ v.co)[3] <= FOLLOW_REACH]
    assert contact, (ctx['id'], name, 'bag has no contact face')
    drift, weights = shell_weights(ctx, pieces, contact)
    print('SHELL', name, 'contact vertices', len(contact), 'worst drift %.1f mm' % (drift * 1000),
          {b: round(x, 3) for b, x in weights.items()}, flush=True)
    for obj in pieces:
        bm = bmesh.new(); bm.from_mesh(obj.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(obj.data); bm.free()
    shell = join(None, pieces, f'{name}.shell', push=False)
    up = sum((skin.find_nearest(p)[1] for p in contact), Vector()).normalized()
    left = pose_clearance_many(ctx, [(shell, [list(range(len(shell.data.vertices)))], [up])], STRAP_MARGIN,
                               others=layer_parts(ctx, FIT_LAYER))
    assert left < .001, (ctx['id'], name, 'bag still pierced', left)
    return [shell]


def _cleared(ctx, strap, normals):
    """Lift strap cross-sections wherever skin pierces them in any clip frame (see pose_clearance).
    A solidified ribbon keeps its vertex order: ribbon point k owns 2k, 2k+1 and their offset twins."""
    n = len(normals) * 2; assert len(strap.data.vertices) == 2 * n, (strap.name, 'unexpected strap topology')
    rows = [[2 * k, 2 * k + 1, n + 2 * k, n + 2 * k + 1] for k in range(len(normals))]
    # Triangulate first: lifted rows make quads non-planar, and the check must see the same
    # triangles the glTF exporter writes (it may split a quad along the other diagonal).
    import bmesh
    bm = bmesh.new(); bm.from_mesh(strap.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(strap.data); bm.free()
    # 16 passes, not 10: on a dense female top a strap segment (~10 cm between rows) is poked at the
    # belly or shoulder in one frame after another, and each pass clears only the worst of each row
    left = pose_clearance(ctx, strap, rows, normals, STRAP_MARGIN, iters=16, others=layer_parts(ctx, FIT_LAYER))   # over lapels too
    assert left < .001, (ctx['id'], strap.name, 'strap still pierced by skin', left)
    return strap


def _near(points, c, r):
    """Rows of the (N, 3) cloud within `r` of point c (keeps standoff() queries cheap)."""
    import numpy as np
    return points[((points - np.array(c)) ** 2).sum(1) < r * r]


def _profile(depth, edge):
    """Dome: full `depth` in the middle, `edge` x depth at the rim."""
    return lambda u, v: depth * (edge + (1 - edge) * math.sqrt(max(0.0, 1 - max(abs(u), abs(v)) ** 4)))


def backpack(ctx, bvh, lm):
    """Soft pack whose front face follows the back, plus two straps that leave the bag's top
    edge, cross the shoulder, run down the chest, pass under the armpit and return to the bag's
    lower corners."""
    i = ctx['id']; P = BACKPACK; fwd, left = lm['fwd'], lm['left']; outer, dressed = outer_bvh(ctx)
    strap_m = material(ctx, 'strap'); bag_m = material(ctx, 'bag')
    z_sh = (shoulder_top(bvh, outer, lm, 1).z + shoulder_top(bvh, outer, lm, -1).z) / 2
    top = z_sh - P['top_drop']; height = P['height'] * (z_sh - lm['upleg.L'][0].z); bottom = top - height
    def axis(z): return _spine_axis(lm, z)
    mid = axis((top + bottom) / 2)
    half_w = P['width'] * min((surface_from_inside(bvh, mid, left * s, 0)[0] - mid).dot(left * s) for s in (1, -1))
    back = -fwd

    cols, rows = P['cols'], P['rows']
    def base(u, v):   # the dressed rest-pose back under grid point (u, v)
        z = bottom + (v + 1) / 2 * height
        return surface_point(dressed, axis(z) + left * (u * half_w), back, 0)[0]
    cloud = _near(rest_points(ctx, [*ctx['body'], *outer_parts(ctx)]), base(0, 0), .45)
    radius = P['reach'] * max(2 * half_w / (cols - 1), height / (rows - 1))
    @functools.lru_cache(maxsize=None)
    def sample(u, v):   # clear every surface point under the vertex's cell, then the gap
        b = base(u, v); return b + back * (max(0.0, standoff(cloud, b, back, radius)) + P['gap']), back
    bind = skin_under(ctx, dressed, back, P['skin_radius'], bone_name(ctx, 'chest'))
    prof = _profile(P['depth'], P['edge'])
    body = pillow(f'{i}_Fit_backpack.body', sample, prof, cols, rows, smooth=True)
    def pocket_sample(u, v):   # face pocket on the lower half of the pack's back face
        bu, bv = u * P['pocket_w'], P['pocket_v'] + v * P['pocket_h']
        p, out = sample(bu, bv); return p + out * (prof(bu, bv) - P['pocket_sink']), out
    pocket = pillow(f'{i}_Fit_backpack.pocket', pocket_sample, _profile(P['pocket_depth'], .5), 4, 3, smooth=True)
    h0, _ = sample(0, 1)   # grab handle over the top edge
    hp = [h0 + left * (P['handle_w'] * math.cos(a)) + UP * (P['handle_h'] * math.sin(a)) + back * P['depth'] * .35
          for a in [k / 4 * math.pi for k in range(5)]]
    handle = tube(f'{i}_Fit_backpack.handle', hp, P['handle_r'], 4)
    parts = _cleared_bag(ctx, [finish(ctx, o, bag_m, 0, rigid=bind, max_influences=4) for o in (body, pocket, handle)], f'{i}_Fit_backpack')
    for s in (1, -1):
        pts, nrm = _onto_surface(dressed, *resample(*strap_path(bvh, outer, dressed, lm, s, top, sample), P['strap_pts']), P['strap_gap'])
        # Where the strap lies on a flared coat hem, far from skin, it takes the pack's bones.
        parts.append(_cleared(ctx, finish(ctx, ribbon(f'{i}_Fit_backpack.strap', pts, P['strap_w'], nrm, smooth=True), strap_m,
                                          P['strap_thick'], fill=bind(sample(0, 0)[0]), max_influences=4), nrm))
    # shell and straps are cleared in every clip frame above; a per-vertex rest push would dent the
    # rigid shell and undo lifts (garam: 2 mm shape change, 3 mm poke)
    return join(None, parts, f'{i}_Fit_backpack', push=False)


def _spine_axis(lm, z):
    """Torso centre line at height z: pelvis centre below the chest, blending to the neck base."""
    lo, hi = pelvis(lm, lm['upleg.L'][0].z), lm['neck'][0]
    u = max(0.0, min(1.0, (z - lo.z) / (hi.z - lo.z)))
    c = lo.lerp(hi, u); c.z = z; return c


def armpit(bvh, lm, side):
    """Point on the side of the ribcage just under the armpit (+1 = character left). In the rest
    T-pose a sideways ray at shoulder height runs down the arm; the first height (descending)
    whose ray meets the ribcage within the shoulder's reach is the armpit."""
    t = lm['shoulder.L' if side > 0 else 'shoulder.R'][1]; d = lm['left'] * side
    reach = (t - _spine_axis(lm, t.z)).dot(d) * .95; z = t.z
    while z > t.z - .4:
        c = _spine_axis(lm, z); hit, _, _, dist = bvh.ray_cast(c, d, reach)
        if hit is not None: return _spine_axis(lm, z - BACKPACK['armpit_drop']) + d * dist
        z -= .01
    raise AssertionError(('no armpit found', side))


def strap_path(bvh, outer, dressed, lm, s, top, bag_sample):
    """Bag top edge -> over the shoulder -> down the chest -> under the armpit -> bag lower corner."""
    P = BACKPACK; fwd, left = lm['fwd'], lm['left']
    S = shoulder_top(bvh, outer, lm, s); A = armpit(bvh, lm, s)
    c = S.lerp(A, .5); u = (S - A).normalized()
    loop, nrm, flat = hull_loop(bvh, outer, c, (fwd - u * u.dot(fwd)).normalized(), u, P['strap_gap'])
    n = len(loop)
    back_side = [k for k in range(n) if flat[k][0] < 0]
    start = min(back_side, key=lambda k: abs(loop[k].z - (top - P['strap_in'])))
    idx = [start]                                               # back -> over the top -> front
    while not (flat[idx[-1]][0] > 0 and loop[idx[-1]].z < S.z - P['chest_drop']): idx.append((idx[-1] - 1) % n)
    pts = [loop[k] for k in idx]; nr = [nrm[k] for k in idx]
    # Down the chest at the strap's own line, then round the ribcage to just under the armpit.
    f0 = pts[-1]; low = A.z - P['armpit_below']; c_low = _spine_axis(lm, low)
    ribs = (surface_from_inside(bvh, c_low, left * s, 0)[0] - c_low).dot(left * s)
    lat0 = (f0 - _spine_axis(lm, f0.z)).dot(left * s); lat = min(lat0, P['chest_lat'] * ribs)
    for q in range(1, P['chest_steps'] + 1):                   # ease in from the shoulder line
        w = q / P['chest_steps']; z = f0.z + (low - f0.z) * w; l = lat0 + (lat - lat0) * (1 - (1 - w) ** 2)
        p, nn = surface_point(dressed, _spine_axis(lm, z) + left * (s * l), fwd, P['strap_gap']); pts.append(p); nr.append(nn)
    a_front = math.atan2(lat, (pts[-1] - c_low).dot(fwd))
    for q in range(1, P['round_steps'] + 1):                  # sweep out and slightly down
        w = q / P['round_steps']; ang = a_front + (math.pi / 2 - a_front) * w; c = _spine_axis(lm, low - P['round_drop'] * w)
        p, nn = layered_from_inside(bvh, outer, c, fwd * math.cos(ang) + left * (s * math.sin(ang)), P['strap_gap'])
        pts.append(p); nr.append(nn)
    a = pts[-1]; k_pt, _ = bag_sample(s * P['strap_corner_u'], P['strap_corner_v'])
    for q in range(1, 5):
        w = q / 4; o = (-fwd * w + left * s * (1 - w)).normalized()
        p, nn = surface_point(dressed, a.lerp(k_pt, w), o, P['strap_gap']); pts.append(p); nr.append(nn)
    return pts, nr


def shoulder_bag(ctx, bvh, lm):
    """Cross-body bag: the strap runs from the far shoulder diagonally across chest and back to
    the bag, which hugs the back of the hip on the other side — behind the swinging hand."""
    i = ctx['id']; P = SHOULDER_BAG; fwd, left = lm['fwd'], lm['left']; outer, dressed = outer_bvh(ctx)
    strap_m = material(ctx, 'strap'); bag_m = material(ctx, 'bag')
    held = hand_prop_side(ctx); s = -held if held else 1       # bag side; strap over the other shoulder
    a0 = math.radians(P['angle'])
    ring = lambda a: fwd * math.cos(a) + left * (s * math.sin(a))
    out0 = ring(a0)
    bind = skin_under(ctx, dressed, out0, P['skin_radius'], bone_name(ctx, 'hips'))
    prof = _profile(P['depth'], P['edge'])

    def place(rise):
        """The bag at `rise` above the hip joint, cleared in every clip frame: (shell, sample, top)."""
        zc = lm['upleg.L'][0].z + rise
        r = (layered_from_inside(bvh, outer, hip_axis(lm, s, zc), ring(a0), 0)[0] - hip_axis(lm, s, zc)).length
        span = P['width'] / 2 / r

        def base(u, v):   # from outside: the outermost of skin, skirt, coat hem or a top's rim
            z = zc + v * P['height'] / 2; d = ring(a0 + u * span)
            return surface_point(dressed, hip_axis(lm, s, z) + d * .1, d, 0)[0]
        cloud = _near(rest_points(ctx, [*ctx['body'], *outer_parts(ctx)]), base(0, 0), .4)
        radius = P['reach'] * max(P['width'] / (P['cols'] - 1), P['height'] / (P['rows'] - 1))
        @functools.lru_cache(maxsize=None)
        def sample(u, v):
            b = base(u, v); return b + out0 * (max(0.0, standoff(cloud, b, out0, radius)) + P['gap']), out0
        bag = pillow(f'{i}_Fit_shoulder_bag.body', sample, prof, P['cols'], P['rows'], smooth=True)
        def flap_sample(u, v):
            bu, bv = u * 1.02, P['flap_v'] + v * P['flap_h']
            p, out = sample(bu, bv); return p + out * (prof(bu, bv) - P['flap_sink']), out
        flap = pillow(f'{i}_Fit_shoulder_bag.flap', flap_sample, lambda u, v: P['flap_thick'], P['cols'], 2, smooth=True)
        shell, = _cleared_bag(ctx, [finish(ctx, o, bag_m, 0, rigid=bind, max_influences=4) for o in (bag, flap)], f'{i}_Fit_shoulder_bag')
        return shell, sample, zc + P['height'] / 2

    # A rigid bag cannot follow a hip whose skin swings with the thigh, so the clearance lifts it off
    # the hip by the swing. How far depends on the body and on what hangs over the hip (trousers:
    # the glute swings through a low bag, ara 17 mm; skirt: a high bag stands off the waistband). Try
    # the heights in turn and keep the first whose contact face lies within BAG_FLOAT_TARGET.
    tried = []
    for rise in P['rises']:
        shell, sample, top = place(rise); gap = _contact_float(ctx, shell)
        print('BAG RISE', shell.name, 'rise %.2f contact median %.1f mm' % (rise, gap * 1000), flush=True)
        tried.append((gap, rise))
        if gap <= BAG_FLOAT_TARGET: break
        bpy.data.objects.remove(shell, do_unlink=True)
    else:
        rise = min(tried)[1]; shell, sample, top = place(rise)
        print('BAG RISE', shell.name, 'none within target, closest rise %.2f' % rise, flush=True)
    parts = [shell]
    # Strap: the band where a plane through the far shoulder and the bag cuts the torso, kept
    # above the bag's top edge and closed into the bag's two top corners.
    S = shoulder_top(bvh, outer, lm, -s); B, _ = sample(0, 1)
    c = S.lerp(B, .5); u = (S - B).normalized()
    loop, nrm, _ = hull_loop(bvh, outer, c, (fwd - u * u.dot(fwd)).normalized(), u, P['strap_gap'],
                             reach=(S - B).length / 2 * 1.02, clamp=True)   # rays into the thigh stop at the bag
    keep = [p.z > top + P['strap_cut'] for p in loop]; n = len(loop)
    first = next(k for k in range(n) if keep[k] and not keep[k - 1])
    arc = []
    for k in range(first, first + n):
        if not keep[k % n]: break
        arc.append(k % n)
    pts = [loop[k] for k in arc]; nr = [nrm[k] for k in arc]
    ends = []
    for cu in (-P['strap_corner_u'], P['strap_corner_u']):
        p, out = sample(cu, P['strap_corner_v']); ends.append((p + out * P['depth'] * P['edge'] * .5, out))
    if (ends[0][0] - pts[0]).length > (ends[0][0] - pts[-1]).length: ends.reverse()
    pts, nr = _onto_surface(dressed, *resample([ends[0][0], *pts, ends[1][0]], [ends[0][1], *nr, ends[1][1]], P['strap_pts']),
                            P['strap_gap'])
    # Near the bag (and under a skirt, where the hip has no skin mesh) the strap ends take the
    # bag's own bone for whatever weight the skin does not supply.
    parts.append(_cleared(ctx, finish(ctx, ribbon(f'{i}_Fit_shoulder_bag.strap', pts, P['strap_w'], nr, smooth=True), strap_m,
                                      P['strap_thick'], fill=bind(sample(0, 0)[0]), max_influences=4), nr))
    # shell and straps are cleared in every clip frame above; a per-vertex rest push would dent the
    # rigid shell and undo lifts (garam: 2 mm shape change, 3 mm poke)
    return join(None, parts, f'{i}_Fit_shoulder_bag', push=False)


# Tuned on dohun / rumi / jun / eun / hyo renders and the clip clash check (metres).
BACKPACK = {'top_drop': .07, 'height': .55, 'width': .70, 'gap': .005, 'depth': .09, 'edge': .38,
            'cols': 5, 'rows': 6, 'reach': .8, 'strap_pts': 14,
            'pocket_w': .72, 'pocket_v': -.45, 'pocket_h': .42, 'pocket_depth': .025, 'pocket_sink': .004,
            'handle_w': .03, 'handle_h': .025, 'handle_r': .006,
            'strap_along': .4, 'armpit_drop': .02, 'chest_drop': .05, 'armpit_below': .06, 'chest_steps': 4,
            'round_steps': 4, 'round_drop': .04, 'chest_lat': .72, 'strap_gap': .007, 'strap_in': .03,
            'strap_w': .036, 'strap_thick': .008, 'skin_radius': .04, 'strap_corner_u': .78, 'strap_corner_v': -.72}
SHOULDER_BAG = {'angle': 150, 'rises': (.12, .07, .16, .20, .24, .28), 'height': .18, 'width': .21, 'depth': .055, 'edge': .4, 'gap': .005,
                'cols': 5, 'rows': 5, 'reach': .8, 'strap_pts': 16,
                'flap_v': .45, 'flap_h': .55, 'flap_thick': .006, 'flap_sink': .002,
                'skin_radius': .04, 'strap_gap': .007, 'strap_w': .032, 'strap_thick': .007, 'strap_cut': .02,
                'strap_corner_u': .85, 'strap_corner_v': .85}
BAG_FLOAT_TARGET = .018   # build target for a bag's contact-face median at rest; the audit limit is 20 mm


def _contact_float(ctx, shell):
    """Median rest distance from what the bag lies on to the shell vertices whose normal faces it
    (about the audit's contact face; it reads a few mm higher, as `on` has no chest layers)."""
    import statistics
    on = body_bvh(ctx, [*ctx['body'], *outer_parts(ctx)]); mw = shell.matrix_world; nm = mw.to_3x3().inverted().transposed()
    gaps = []
    for v in shell.data.vertices:
        p = mw @ v.co; hit = on.find_nearest(p)
        if hit[0] is not None and (hit[0] - p).length > 1e-6 and (nm @ v.normal).normalized().dot((hit[0] - p).normalized()) > .5:
            gaps.append(hit[3])
    assert gaps, (ctx['id'], shell.name, 'bag has no contact face')
    return statistics.median(gaps)

# ---------------------------------------------------------------- chest layers
# Garments lying flat on the chest: the shirt showing in the jacket opening, the shirt collar,
# a vest's opening trim and the jacket lapels. They are built before everything else, each on
# top of the ones before it (see ORDER), and they count as surface for what comes after them:
# scarf and bow lie over the lapels, bag straps over lapels and collars.
FIT_LAYER = re.compile(r'_Fit_(shirt_v|shirt_collar|vest_v|lapel)$')
LAYER_SURFACE = re.compile(r'(_Fit_(shirt_v|shirt_collar|vest_v|lapel)|Turtleneck(\.\d{3})?|_Neckwear(\.\d{3})?)$')
KEEP_IN_FRONT = {'Tie', 'ID badge', 'ID lanyard', 'ID photo', 'Badge', 'BadgeLanyard', 'Button'}


def layer_parts(ctx, pattern=LAYER_SURFACE):
    return [o for n, o in ctx['parts'].items() if pattern.search(n)]


def layer_bvh(ctx):
    """(garments on the chest/neck alone or None, body + those garments) — as outer_bvh."""
    objs = layer_parts(ctx)
    if not objs: return None, body_bvh(ctx)
    return body_bvh(ctx, objs), body_bvh(ctx, [*ctx['body'], *objs])


class Chart:
    """2D chart over the front of the torso: (lat, dz) in metres of the reference body, lat toward
    the character's left, dz up from the neck bone head. Scaled by torso length, so the same
    outline fits every build of either rig. A chart point is on the plane through the neck's
    centre line; casting from in front of it along -fwd finds the garment's footing."""
    REF = {'male': .603, 'female': .718}   # neck head - hip joint height of office-jun / office-seo

    def __init__(self, ctx, bvh, lm):
        male = 'Human' in ctx['rig'].name; head = lm['neck'][0]
        self.k = (head.z - lm['upleg.L'][0].z) / self.REF['male' if male else 'female']
        self.o = neck_axis(bvh, lm, CHEST['male' if male else 'female']['neck_at']); self.o.z = head.z
        self.fwd, self.left = lm['fwd'], lm['left']; self.male = male

    def at(self, lat, dz):
        return self.o + self.left * (lat * self.k) + UP * (dz * self.k)

    def ring(self, dz):
        """Neck centre at chart height dz (the neck is near vertical over the collar's span)."""
        return self.o + UP * (dz * self.k)


def _cloud(ctx, ch, *extra):
    """Rest-pose vertices of body, the layers built so far and `extra`, near the chest."""
    return _near(rest_points(ctx, [*ctx['body'], *layer_parts(ctx), *extra]), ch.at(0, -.15), .45)


def _edge(poly, v):
    """Point at arc-length fraction v along a 2D polyline."""
    seg = [math.dist(poly[i], poly[i + 1]) for i in range(len(poly) - 1)]; t = v * sum(seg)
    for i, L in enumerate(seg):
        if t <= L or i == len(seg) - 1:
            u = min(1.0, t / L) if L else 0.0
            return (poly[i][0] + (poly[i + 1][0] - poly[i][0]) * u, poly[i][1] + (poly[i + 1][1] - poly[i][1]) * u)
        t -= L


def _sheet(name, grid):
    """Quad sheet from a rows x cols grid of world points, faces wound so they face the grid's
    own outward direction (the caller passes it as grid normals). Returns the object."""
    import bpy, bmesh
    pts, nrm = grid; R, C = len(pts), len(pts[0])
    bm = bmesh.new(); vs = [[bm.verts.new(pts[r][c]) for c in range(C)] for r in range(R)]
    for r in range(R - 1):
        for c in range(C - 1):
            f = bm.faces.new((vs[r][c], vs[r + 1][c], vs[r + 1][c + 1], vs[r][c + 1]))
            f.normal_update()
            if f.normal.dot(nrm[r][c] + nrm[r + 1][c + 1]) < 0: f.normal_flip()
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for poly in me.polygons: poly.use_smooth = True
    return link(name, me)


def chest_panel(ch, dressed, cloud, name, left_edge, right_edge, rows, cols, offset):
    """Sheet between two chart polylines (sampled top to bottom by arc length), every vertex cast
    onto the dressed chest from the front, then lifted along the surface normal over every point
    of `cloud` (rest-pose vertices of body and layers beneath) around it — the faceted body's
    ridges otherwise poke through a flush sheet between its vertices — plus `offset`.
    Returns (object, per-vertex rest normals in vertex order)."""
    pts, nrm = [], []
    for r in range(rows):
        v = r / (rows - 1); a, b = _edge(left_edge, v), _edge(right_edge, v); prow, nrow = [], []
        for c in range(cols):
            u = c / (cols - 1); q = ch.at(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
            p, n = surface_point(dressed, q, ch.fwd, 0); prow.append(p); nrow.append(n)
        pts.append(prow); nrm.append(nrow)
    for r in range(rows):
        for c in range(cols):   # the cell around the vertex: half-way to its farthest grid neighbour
            p = pts[r][c]; near = [pts[r + dr][c + dc] for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                                   if 0 <= r + dr < rows and 0 <= c + dc < cols]
            radius = PANEL_REACH * max((p - q).length for q in near)
            pts[r][c] = p + nrm[r][c] * (max(0.0, standoff(cloud, p, nrm[r][c], radius, .03)) + offset)
    return _sheet(name, (pts, nrm)), [n for row in nrm for n in row]


def collar_band(ch, skin, outer, name, dz_top, dz_low, flare, angles, offset):
    """Standing band around the neck through the given angles (0 = front): the top edge hugs the
    neck at dz_top; the lower edge runs down the neck toward dz_low but stops where the body
    flares out more than `flare` beyond the top edge (the trapezius rises high at the sides, so
    the band is shorter there instead of splaying onto the shoulders). Layers in `outer` (a
    turtleneck, a shirt collar) are surface. Returns (object, per-vertex rest normals)."""
    step = .004; top, low, nt, nl = [], [], [], []
    for a in angles:
        d = _around({'fwd': ch.fwd, 'left': ch.left}, a)
        pt, n0 = layered_from_inside(skin, outer, ch.ring(dz_top), d, offset); r_top = (pt - ch.ring(dz_top)).dot(d)
        dz = dz_top; best = (pt, n0)
        while dz - step / ch.k >= dz_low:
            dz -= step / ch.k; c = ch.ring(dz)
            p, n = layered_from_inside(skin, outer, c, d, offset)
            if (p - c).dot(d) > r_top + flare: break
            best = (p, n)
        top.append(pt); nt.append(n0); low.append(best[0]); nl.append(best[1])
    return _sheet(name, ([low, top], [nl, nt])), nl + nt


def _layer_finish(ctx, obj, normals, mat, thickness):
    """Solidify + skin (finish), then triangulate as the glTF exporter will. A solidified sheet
    keeps its order: vertex k and its offset twin N + k form one row lifted together."""
    import bmesh
    n = len(obj.data.vertices); assert n == len(normals), (obj.name, 'normals', n, len(normals))
    finish(ctx, obj, mat, thickness, fill={bone_name(ctx, 'neck'): 1.0}, max_influences=4)   # e.g. over a turtleneck, off the skin
    assert len(obj.data.vertices) == 2 * n, (obj.name, 'unexpected solidify topology')
    bm = bmesh.new(); bm.from_mesh(obj.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(obj.data); bm.free()
    return obj, [[k, n + k] for k in range(n)], normals + normals


def _layer_join(ctx, dressed, pieces, name):
    """Lift every piece clear of body and of the layers beneath in every clip frame, then join."""
    left = pose_clearance_many(ctx, pieces, LAYER_MARGIN, others=layer_parts(ctx, FIT_LAYER))
    assert left < .001, (ctx['id'], name, 'layer still pierced', left)
    return join(dressed, [o for o, _, _ in pieces], name, push=False)   # cleared above; a per-vertex push would undo it


def _mirror(poly, s):
    return [(s * x, z) for x, z in poly]


def shirt_v(ctx, bvh, lm):
    """The shirt showing in the jacket (or vest) opening: a V lying flush on the chest from under
    the collar down to where the lapels meet."""
    i = ctx['id']; outer, dressed = layer_bvh(ctx); ch = Chart(ctx, bvh, lm)
    C = CHEST['male']; V = C['vest_shirt_v'] if 'vest_v' in ctx.get('plan_add', ()) else C['shirt_v']
    sheet, nrm = chest_panel(ch, dressed, _cloud(ctx, ch), f'{i}_Fit_shirt_v', _mirror(V, -1), _mirror(V, 1), C['v_rows'], C['v_cols'], C['v_offset'])
    return _layer_join(ctx, dressed, [_layer_finish(ctx, sheet, nrm, material(ctx, 'shirt'), C['v_thick'])], f'{i}_Fit_shirt_v')


def shirt_collar(ctx, bvh, lm):
    """Thick standing collar hugging the neck, open at the front, with two small points lying
    on the chest (over the shirt V)."""
    import bpy
    i = ctx['id']; outer, dressed = layer_bvh(ctx); ch = Chart(ctx, bvh, lm); C = CHEST['male']; mat = material(ctx, 'shirt')
    gap = math.radians(C['collar_gap']); n = C['collar_n']
    angles = [gap + (math.tau - 2 * gap) * k / (n - 1) for k in range(n)]
    band = _layer_finish(ctx, *collar_band(ch, bvh, outer, f'{i}_Fit_shirt_collar.band', C['collar_top'], C['collar_low'],
                                           C['collar_flare'], angles, C['collar_offset']), mat, C['collar_thick'])
    on = body_bvh(ctx, [*ctx['body'], *layer_parts(ctx), band[0]])   # points lie over the band's front ends
    pieces = [band]
    for s in (1, -1):
        sheet, nrm = chest_panel(ch, on, _cloud(ctx, ch, band[0]), f'{i}_Fit_shirt_collar.point', _mirror(C['point_in'], s), _mirror(C['point_out'], s),
                                 C['point_rows'], 2, C['point_offset'])
        pieces.append(_layer_finish(ctx, sheet, nrm, mat, C['point_thick']))
    return _layer_join(ctx, dressed, pieces, f'{i}_Fit_shirt_collar')


def vest_v(ctx, bvh, lm):
    """A vest's V opening: two slim bands in the vest's cloth along the edges of the shirt V."""
    i = ctx['id']; outer, dressed = layer_bvh(ctx); ch = Chart(ctx, bvh, lm); C = CHEST['male']; pieces = []
    for s in (1, -1):
        sheet, nrm = chest_panel(ch, dressed, _cloud(ctx, ch), f'{i}_Fit_vest_v.trim', _mirror(C['vest_in'], s), _mirror(C['vest_out'], s),
                                 C['vest_rows'], 2, C['vest_offset'])
        pieces.append(_layer_finish(ctx, sheet, nrm, material(ctx, 'coat'), C['vest_thick']))
    return _layer_join(ctx, dressed, pieces, f'{i}_Fit_vest_v')


def lapel(ctx, bvh, lm):
    """Jacket lapels: two thick peaked lapels lying on the chest either side of the opening, and
    the jacket collar running round the back of the neck into their tops."""
    i = ctx['id']; outer, dressed = layer_bvh(ctx); ch = Chart(ctx, bvh, lm)
    C = CHEST['male' if ch.male else 'female']; mat = material(ctx, 'coat')
    gap = math.radians(C['band_gap']); n = C['band_n']
    angles = [gap + (math.tau - 2 * gap) * k / (n - 1) for k in range(n)]
    band = _layer_finish(ctx, *collar_band(ch, bvh, outer, f'{i}_Fit_lapel.collar', C['band_top'], C['band_low'],
                                           C['band_flare'], angles, C['band_offset']), mat, C['lapel_thick'])
    on = body_bvh(ctx, [*ctx['body'], *layer_parts(ctx), band[0]])
    pieces = [band]
    for s in (1, -1):
        sheet, nrm = chest_panel(ch, on, _cloud(ctx, ch, band[0]), f'{i}_Fit_lapel.side', _mirror(C['lapel_in'], s), _mirror(C['lapel_out'], s),
                                 C['lapel_rows'], C['lapel_cols'], C['lapel_offset'])
        pieces.append(_layer_finish(ctx, sheet, nrm, mat, C['lapel_thick']))
    return _layer_join(ctx, dressed, pieces, f'{i}_Fit_lapel')


def nudge_forward(ctx, bases, clearance):
    """Kept front pieces (tie, badge, buttons) that the new layers would cover are moved, whole,
    forward along fwd until they clear the layers' front by `clearance`. Move only: vertex count
    and shape are unchanged. Returns {part name: metres moved}."""
    layers = layer_parts(ctx, FIT_LAYER)
    if not layers: return {}
    fwd = landmarks(ctx)['fwd']; front = body_bvh(ctx, layers); moved = {}
    for name, o in ctx['parts'].items():
        if re.sub(r'\.\d{3}$', '', name).removeprefix(ctx['id'] + '_') not in bases: continue
        mw = o.matrix_world; need = 0.0
        for v in o.data.vertices:
            w = mw @ v.co; hit = front.ray_cast(w + fwd * .3, -fwd, .6)[0]
            if hit is not None: need = max(need, (hit - w).dot(fwd) + clearance)
        if need > 0:
            d = mw.inverted().to_3x3() @ (fwd * need)
            for v in o.data.vertices: v.co += d
            o.data.update(); moved[name] = need
    return moved


# Tuned on jun / do / sungho / seo / garam renders (metres on the chart, rest pose).
CHEST = {
    'male': {'neck_at': .3,
             'shirt_v': [(.09, .03), (0.0, -.39)], 'vest_shirt_v': [(.09, .03), (0.0, -.33)],
             'v_rows': 7, 'v_cols': 5, 'v_offset': .003, 'v_thick': .002,
             'collar_gap': 24, 'collar_n': 17, 'collar_top': .052, 'collar_low': .0, 'collar_flare': .022,
             'collar_offset': .002, 'collar_thick': .006,
             'point_in': [(.028, .04), (.05, -.055)], 'point_out': [(.075, .018), (.056, -.058)],
             'point_rows': 3, 'point_offset': .003, 'point_thick': .004,
             'vest_in': [(.074, .01), (.003, -.32)], 'vest_out': [(.098, .0), (.018, -.33)],
             'vest_rows': 6, 'vest_offset': .003, 'vest_thick': .004,
             'band_gap': 40, 'band_n': 15, 'band_top': .03, 'band_low': -.03, 'band_flare': .03, 'band_offset': .003,
             'lapel_in': [(.066, .0), (.004, -.35)], 'lapel_out': [(.105, -.008), (.145, -.10), (.03, -.35)],
             'lapel_rows': 8, 'lapel_cols': 3, 'lapel_offset': .003, 'lapel_thick': .006},
    'female': {'neck_at': .3,
               'band_gap': 40, 'band_n': 15, 'band_top': .012, 'band_low': -.04, 'band_flare': .03, 'band_offset': .003,
               'lapel_in': [(.05, -.012), (.006, -.31)], 'lapel_out': [(.088, -.022), (.13, -.11), (.035, -.31)],
               'lapel_rows': 9, 'lapel_cols': 3, 'lapel_offset': .003, 'lapel_thick': .006},
}
LAYER_MARGIN = .0015   # clearance a chest layer keeps over skin and the layers beneath, every clip frame

TEMPLATES = {'scarf': scarf, 'bow': bow, 'backpack': backpack, 'shoulder_bag': shoulder_bag,
             'shirt_v': shirt_v, 'shirt_collar': shirt_collar, 'vest_v': vest_v, 'lapel': lapel}
# Build order: each layer lies on the ones before it; neckwear and bags lie on all of them.
ORDER = ('shirt_v', 'shirt_collar', 'vest_v', 'lapel', 'scarf', 'bow', 'backpack', 'shoulder_bag')


def apply_templates(ctx, plan):
    bvh = body_bvh(ctx); lm = landmarks(ctx); made = []
    ctx['plan_add'] = tuple(plan['add'])
    unknown = [t for t in plan['add'] if t not in TEMPLATES]
    assert not unknown, ('template not implemented yet', unknown)
    for t in sorted(plan['add'], key=ORDER.index):
        obj = TEMPLATES[t](ctx, bvh, lm); ctx['parts'][obj.name] = obj; made.append(obj.name)
    moved = nudge_forward(ctx, KEEP_IN_FRONT, NUDGE_CLEARANCE)
    if moved: print('NUDGE', ctx['id'], {k: round(v * 1000, 1) for k, v in moved.items()}, flush=True)
    # Building leaves the rig in rest pose (body_bvh); the exporter samples clips through the
    # pose, so a rig left in REST would ship every clip frozen in the T-pose.
    ctx['rig'].data.pose_position = 'POSE'; bpy.context.view_layer.update()
    return made


NUDGE_CLEARANCE = .003
PANEL_REACH = .6   # standoff cylinder radius, as a fraction of the distance to the farthest grid neighbour


HEM_BAND = .25        # height above the hem over which the shell's lengthening is spread
HEM_TUCK = .015       # the thigh tubes end this far above the hem's new ceiling, inside the shell
HEM_OVERLAP = .005    # ... and this far below the top of the leg skin, so no gap opens between them


def _skirt_regions(bm):
    """The supplied dress is one mesh: an outer shell (one hem loop) and two thigh tubes (one
    loop each) that join the shell along a non-manifold seam at the crotch. Grow each region from
    its bottom loop without crossing the seam."""
    seam = {v for e in bm.edges if len(e.link_faces) > 2 for v in e.verts}
    boundary = {v for e in bm.edges if e.is_boundary for v in e.verts}
    loops, seen = [], set()
    for v in boundary:
        if v in seen: continue
        loop, stack = [], [v]
        while stack:
            x = stack.pop()
            if x in seen: continue
            seen.add(x); loop.append(x)
            stack += [e.other_vert(x) for e in x.link_edges if e.is_boundary]
        loops.append(loop)
    loops = sorted((l for l in loops if not seam & set(l)), key=lambda l: sum(v.co.z for v in l) / len(l))
    waist = loops.pop()   # the only loop far above the others

    def grow(start):
        region, stack = set(), list(start)
        while stack:
            x = stack.pop()
            if x in region: continue
            region.add(x)
            if x not in seam: stack += [e.other_vert(x) for e in x.link_edges]
        return region
    hem = max(loops, key=len)   # the shell's hem is the widest loop; the tubes' are small
    tubes = [l for l in loops if l is not hem]
    tube = set().union(*(grow(l) for l in tubes)) - seam if tubes else set()
    return hem, tubes, tube, waist


def fix_skirt_hem(ctx, skirt_name):
    """Bring the shell's high back hem down just far enough to cover the thigh tubes, and tuck the
    tubes' ends up inside it while they still overlap the top of the leg skin.

    Measured on the supplied dress (office-daeun, world metres): the shell's hem slopes from 0.409 at
    the front to 0.501 at the back, while the two thigh tubes inside it end at 0.398-0.494 — so from
    behind the tubes' ragged ends hang below the shell and read as a jagged under-layer / the
    skirt's inside. Rest-pose vertex positions only: the vertex count and skin weights stay."""
    import bmesh, math
    rig = ctx['rig']; rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
    o = ctx['parts'][skirt_name]; mw = o.matrix_world; inv = mw.inverted()
    lm = landmarks(ctx); fwd, left = lm['fwd'], lm['left']
    bm = bmesh.new(); bm.from_mesh(o.data); bm.transform(mw)
    hem, tubes, tube, _waist = _skirt_regions(bm)   # the waist loop is not used by the hem fix
    shell = set(bm.verts) - tube
    centre = sum((v.co for v in hem), Vector()) / len(hem)

    def ang(p):
        d = p - centre; return math.atan2(d.dot(left), d.dot(fwd))
    ring = sorted((ang(v.co), v.co.z) for v in hem)

    def hem_z(a):   # hem height at angle a, linear between the loop's vertices
        for (a0, z0), (a1, z1) in zip(ring[-1:] + ring, ring):
            if a0 > a1: a1 += 2 * math.pi
            for aa in (a, a + 2 * math.pi):
                if a0 <= aa <= a1: return z0 + (z1 - z0) * (aa - a0) / max(a1 - a0, 1e-9)
        return ring[0][1]
    # The tubes stand in for the thighs (the leg skin stops just above the knee), so they must still
    # reach down over the skin's top edge; the hem only needs to come down far enough to hide them.
    # Lowering it further (e.g. level with the front) makes the back leg poke through in the walk.
    legs = [o for o in ctx['body'] if o.name.endswith('LegsShoes')]
    skin_top = max((o.matrix_world @ v.co).z for o in legs for v in o.data.vertices)
    floor = skin_top - HEM_OVERLAP; ceiling = floor - HEM_TUCK
    zs = lambda vs: [v.co.z for v in vs]
    sd = lambda xs: (sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / len(xs)) ** .5
    back = [v for v in hem if (v.co - centre).dot(fwd) < 0]; front = [v for v in hem if (v.co - centre).dot(fwd) >= 0]
    tube_low = min(v.co.z for l in tubes for v in l)
    print('SKIRT', ctx['id'], 'hem', len(hem), 'z %.3f..%.3f' % (min(zs(hem)), max(zs(hem))),
          'sd back %.4f front %.4f' % (sd(zs(back)), sd(zs(front))),
          'tubes', [len(l) for l in tubes], 'tube low %.3f' % tube_low, 'skin top %.3f' % skin_top, 'hem ceiling %.3f' % ceiling, flush=True)
    for v in shell:   # lengthen the shell where its hem sits above `ceiling`, spread over HEM_BAND
        h = hem_z(ang(v.co)); top = h + HEM_BAND
        if h > ceiling and v.co.z < top: v.co.z -= (h - ceiling) * min(1, (top - v.co.z) / HEM_BAND)
    for v in tube:
        if v.co.z < floor: v.co.z = floor
    after = zs(hem)
    print('SKIRT', ctx['id'], 'after hem z %.3f..%.3f' % (min(after), max(after)),
          'tube low %.3f' % min(v.co.z for v in tube), flush=True)
    bm.transform(inv); bm.to_mesh(o.data); bm.free(); o.data.update()
    for m in o.data.materials: m.use_backface_culling = False   # exported as doubleSided
    rig.data.pose_position = 'POSE'; bpy.context.view_layer.update()

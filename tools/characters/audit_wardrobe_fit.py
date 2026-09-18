"""Audit fitted wardrobe parts (`<id>_Fit_*` nodes) on the shipped office GLBs against the source snapshots.
Blender --background --disable-autoexec --python-exit-code 1 --python tools/characters/audit_wardrobe_fit.py -- [--plans art/wardrobe-fit/plans.json] [ids...]

Per look (spec §4.5), every check measured on the exported file as the game plays it (NLA muted, one clip at a time):
  clips      exactly idle/walk/sit; sole height >= -2 mm on every quarter frame (audit_office_wardrobe.py's check)
  poke       worst depth of a body vertex (arms included, reported apart) inside a Fit part, every 2nd frame of
             every clip; a candidate (signed distance to the part's nearest face, searched with no radius, < 0)
             counts only when ray parity confirms it is inside. Bag contact faces are part of the bag node.
  sink       worst depth of a Fit vertex behind the nearest body face (no search radius), confirmed by ray parity,
             same frames: the part sinking under the skin. Excused only as an armpit (wardrobe_geometry.armpit_excused,
             the build's rule too): an upper-arm face whose surface there is within ARMPIT_TOUCH of a torso face
             (the arm has closed on the torso), depth <= ARMPIT_CAP. Every excused sample is listed in audit.json (part 'armpit'); the worst is sinkArm.
  bagShape   bags move as one shell: the largest change of any bag-body/pocket/handle/flap edge length over the
             same frames, against rest, measured in armature space (<= 2 mm; see rig_space)
  skin       every Fit and body vertex has <= 4 bone weights summing to 1 (what three.js skins with)
  overlap    worst depth of another Fit part's vertex inside a Fit part (0 expected)
  hidden     vertices of kept front pieces (tie, badge, buttons) with a new chest layer in front of them, at rest
             and on idle frame 0 (0 expected)
  float      rest-pose median distance of a part's vertices to what it lies on: body plus the garments beneath it
             (skirt, coat hem, hood, vest, turtleneck/neckwear and the Fit layers built before it). Bags count their
             contact face only (spec: 가방 접촉면에만 적용); straps count as ordinary parts. The 20 mm cap binds
             on the median, not on every vertex: real, intended geometry stands off the surface it lies on by more
             than 20 mm at some vertices (a rolled scarf, a domed backpack), so a flat per-vertex 20 mm bound would
             fail correct parts. The median still catches a part that is systematically misplaced; `reach` below
             is the per-vertex backstop that catches any single stray vertex the median would average away.
  reach      no part vertex stands more than 60 mm (bags 150 mm) off what it lies on at rest: the largest real
             reach is a scarf roll (49) and a 9 cm domed backpack with its handle (123); a stray lifted vertex
             (jun's strap spike, 327) is not
  contract   wardrobe_fit.contract_problems(source, shipped): clips, clip motion, body/mesh vertex counts, bounds,
             normScale, node names
  size       sum of shipped bytes <= 1.10 x the source snapshots, over the audited looks
Writes art/wardrobe-fit/audit.json (repo root); prints `AUDIT PASS|FAIL <id> ...` per look and a `SIZE` line;
exits 1 on any failure.
"""
import bpy, json, re, statistics, sys
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wardrobe_fit import ROOT, SRC, OUT, BODY, base, bone_shapes, contract, contract_problems
from wardrobe_geometry import ARM, _inside, armpit_excused, face_classes, ARMPIT_CAP, ARMPIT_TOUCH
from wardrobe_templates import FIT_LAYER, KEEP_IN_FRONT, ORDER

LIMIT = {'pen': .001, 'float': .020, 'size': 1.10, 'sole': -.002, 'bagShape': .002, 'reach': .06, 'reachBag': .15}
STEP = 2                      # every 2nd frame of every clip
CLIPS = {'idle', 'walk', 'sit'}
UNDER = re.compile(r'(Skirt|CoatHem|Hood|Hood down|Vest|Turtleneck|_Neckwear)(\.\d{3})?$')   # kept garments a part may lie on
BAGS = ('backpack', 'shoulder_bag')
CONTACT_DIAG = .35            # straps are the long pieces of a bag node (pocket, handle and flap are compact)


def fit_name(o): return o.name.split('_Fit_')[1]


def world(o, dg):
    """(vertices (N,3) numpy, vertex normals (N,3), polygons) of the evaluated mesh, world space."""
    ev = o.evaluated_get(dg); me = ev.to_mesh(); n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co)
    no = np.empty(n * 3); me.vertices.foreach_get('normal', no)
    polys = [list(p.vertices) for p in me.polygons]; ev.to_mesh_clear()
    M = np.array(ev.matrix_world); R = M[:3, :3]
    nrm = no.reshape(-1, 3) @ np.linalg.inv(R)   # normals by the inverse transpose
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
    return co.reshape(-1, 3) @ R.T + M[:3, 3], nrm, polys


def tree(meshes):
    vs, ps = [], []
    for V, _, P in meshes:
        off = len(vs); vs += [Vector(v) for v in V]; ps += [[off + i for i in p] for p in P]
    return BVHTree.FromPolygons(vs, ps) if ps else None


def components(polys, n):
    """Vertex index lists of the connected pieces of a mesh."""
    parent = list(range(n))
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for p in polys:
        r = find(p[0])
        for i in p[1:]: parent[find(i)] = r
    out = {}
    for i in range(n): out.setdefault(find(i), []).append(i)
    return list(out.values())


def fwd_of(rig):
    """Facing in the current pose, from the shoulders (the male rig faces +X at rest, -Y in every clip)."""
    L, R = ('LeftShoulder', 'RightShoulder') if 'Human' in rig.name else ('Shoulder.L', 'Shoulder.R')
    m = rig.matrix_world; left = (m @ rig.pose.bones[L].tail) - (m @ rig.pose.bones[R].tail); left.z = 0
    return left.normalized().cross(Vector((0, 0, 1))).normalized()


def play(rig, act, frame, sub=0.0):
    ad = rig.animation_data; ad.action = act; ad.action_slot = act.slots[0]
    scene = bpy.context.scene; scene.frame_set(frame + 1); scene.frame_set(frame, subframe=sub)
    bpy.context.view_layer.update(); return bpy.context.evaluated_depsgraph_get()


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=str(path))
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for name in bone_shapes(rig):
        o = bpy.data.objects.get(name)
        if o is not None: bpy.data.objects.remove(o, do_unlink=True)
    for t in rig.animation_data.nla_tracks: t.mute = True
    return rig, [o for o in bpy.data.objects if o.type == 'MESH']


def rig_space(rig, V):
    """World points into the armature's space. The female rig's world matrix scales X and Y/Z
    differently (.26 vs .17), so even a one-bone rotation stretches shapes in world space — the
    body too, as the game draws it. Rigidity is measured where the bones actually rotate."""
    M = np.linalg.inv(np.array(rig.matrix_world)); return V @ M[:3, :3].T + M[:3, 3]


def skin_problems(objs):
    """Vertices with more than 4 bone weights or weights not summing to 1, per mesh."""
    bad = {}
    for o in objs:
        n = sum(1 for v in o.data.vertices
                if sum(1 for g in v.groups if g.weight > 0) > 4 or abs(sum(g.weight for g in v.groups) - 1) > 1e-3)
        if n: bad[o.name] = n
    return bad


def soles(rig, meshes):
    """Lowest shoe vertex over every quarter frame of every clip (audit_office_wardrobe.py's floor check)."""
    skinned = [o for o in meshes if any(m.type == 'ARMATURE' for m in o.modifiers)]
    shoes = {o: [i for p in o.data.polygons if o.data.materials[p.material_index].name.lower().split('.')[0].endswith('shoes')
                 for i in p.vertices] for o in skinned}
    shoes = {o: sorted(set(v)) for o, v in shoes.items() if v}
    assert shoes, 'no shoe material found'
    out = {}
    for act in bpy.data.actions:
        f0, f1 = act.frame_range; low = 1e9
        for k in range(int(round((f1 - f0) * 4)) + 1):
            fr = f0 + k / 4; dg = play(rig, act, int(fr), fr % 1)
            for o, idx in shoes.items():
                V = world(o, dg)[0]; low = min(low, float(V[idx, 2].min()))
        out[act.name] = round(low, 4)
    return out


def hidden(fits, keep, dg, fwd):
    """(vertices of kept front pieces with a new chest layer in front of them, vertices checked)."""
    layers = [world(f, dg) for f in fits if FIT_LAYER.search(f.name)]
    if not layers or not keep: return [0, 0]
    front = tree(layers); h = n = 0
    for o in keep:
        for w in world(o, dg)[0]:
            n += 1; w = Vector(w)
            if front.ray_cast(w + fwd * 1e-4, fwd, .5)[0] is not None: h += 1
    return [h, n]


def bag_faces(V, N, P, surf):
    """(contact-face vertices, strap vertices) of a bag node. The bag body is the piece with the largest
    difference between its far side and its near side (a 5-9 cm pillow; straps are ~8 mm shells, pocket,
    handle and flap lie on the bag, not on the body); its contact face is the vertices whose normal faces
    what the bag lies on. Straps are the long pieces (bounding diagonal > CONTACT_DIAG)."""
    best, face, bag, long = -1.0, [], None, []
    for k, comp in enumerate(components(P, len(V))):
        near, far, facing = [], [], []
        for i in comp:
            hit, _, _, d = surf.find_nearest(Vector(V[i])); dv = Vector(hit) - Vector(V[i])
            dot = Vector(N[i]).dot(dv.normalized()) if dv.length > 1e-6 else 0.0
            if dot > .5: near.append(d); facing.append(i)
            elif dot < -.5: far.append(d)
        depth = statistics.median(far) - statistics.median(near) if near and far else 0.0
        if depth > best: best, face, bag = depth, facing, k
        pts = V[comp]
        if np.linalg.norm(pts.max(0) - pts.min(0)) > CONTACT_DIAG: long.append((k, comp))
    straps = [i for k, comp in long if k != bag for i in comp]
    assert face, 'bag contact face is empty'
    return face, straps


def rest_float(ident, rig, meshes, fits, body):
    """{part: {median, bodyMedian, n}} in mm, rest pose."""
    rig.data.pose_position = 'REST'; bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    skin = [world(o, dg) for o in body]
    under = [world(o, dg) for o in meshes if '_Fit_' not in o.name and UNDER.search(o.name)]
    skin_t = tree(skin); out = {}; shapes = {}
    for f in fits:
        t = fit_name(f)
        below = [world(g, dg) for g in fits if g is not f and fit_name(g) in ORDER and t in ORDER
                 and ORDER.index(fit_name(g)) < ORDER.index(t) and FIT_LAYER.search(g.name)]
        surf = tree([*skin, *under, *below]); V, N, P = world(f, dg)
        pick, straps = range(len(V)), []
        if t in BAGS:
            pick, straps = bag_faces(V, N, P, surf)
            skip = set(straps)
            edges = sorted({tuple(sorted((q[k], q[k - 1]))) for q in P for k in range(len(q)) if q[k] not in skip and q[k - 1] not in skip})
            e = np.array(edges); L = rig_space(rig, V); shapes[f.name] = (e, np.linalg.norm(L[e[:, 0]] - L[e[:, 1]], axis=1))
        every = [surf.find_nearest(Vector(v))[3] for v in V]   # no vertex may stand far off (a spike)
        gaps = [surf.find_nearest(Vector(V[i]))[3] for i in pick]
        bare = [skin_t.find_nearest(Vector(V[i]))[3] for i in pick]
        out[t] = {'median': round(statistics.median(gaps) * 1000, 1), 'bodyMedian': round(statistics.median(bare) * 1000, 1),
                  'n': len(gaps), 'maxMm': round(max(every) * 1000, 1)}
        if straps:
            out[t]['strapMedian'] = round(statistics.median(surf.find_nearest(Vector(V[i]))[3] for i in straps) * 1000, 1)
    hid = hidden(fits, [o for o in meshes if base(o.name).removeprefix(ident + '_') in KEEP_IN_FRONT], dg, fwd_of(rig))
    rig.data.pose_position = 'POSE'; bpy.context.view_layer.update()
    return out, hid, shapes


def clash(ident, rig, meshes, fits, body, shapes):
    """Per part, worst depths in mm (negative = inside) over every STEP-th frame of every clip."""
    isarm = {}
    for o in body:
        names = {g.index: g.name for g in o.vertex_groups}
        isarm[o.name] = np.array([sum(g.weight for g in v.groups if ARM.search(names[g.group])) > .5 for v in o.data.vertices])
    res = {fit_name(f): {'poke': 0.0, 'pokeArm': 0.0, 'sink': 0.0, 'sinkArm': 0.0, 'overlap': {}, 'at': {}, 'armpit': []}
           for f in fits}
    for f in fits:
        if f.name in shapes: res[fit_name(f)]['bagShape'] = 0.0
    classes = face_classes(body)                       # per polygon of the body tree, in the same order
    keep = [o for o in meshes if base(o.name).removeprefix(ident + '_') in KEEP_IN_FRONT]
    hid_idle = None

    def note(r, key, sd, where):
        mm = round(sd * 1000, 2)
        if mm < r[key]: r[key] = mm; r['at'][key] = where   # [clip, frame, what, world position]

    for act in sorted(bpy.data.actions, key=lambda a: a.name):
        f0, f1 = (int(x) for x in act.frame_range)
        for fr in range(f0, f1 + 1, STEP):
            dg = play(rig, act, fr)
            if hid_idle is None and act.name == 'idle': hid_idle = hidden(fits, keep, dg, fwd_of(rig))
            fm = {f.name: world(f, dg) for f in fits}
            ft = {n: tree([m]) for n, m in fm.items()}
            box = {n: (m[0].min(0) - .02, m[0].max(0) + .02) for n, m in fm.items()}
            bm = {o.name: world(o, dg) for o in body}
            bt = tree(list(bm.values()))
            BVall = [v for V, _, _ in bm.values() for v in V]; off = 0; TP = []
            for V, _, P in bm.values():
                TP += [[off + i for i in q] for q in P]; off += len(V)
            TP = [q for q, c in zip(TP, classes) if c == 'torso']
            tt = BVHTree.FromPolygons([Vector(v) for v in BVall], TP)
            for n, bv in ft.items():                       # body vertices inside a part
                r = res[n.split('_Fit_')[1]]; lo, hi = box[n]
                for bn, (V, _, _) in bm.items():
                    for k in np.nonzero(np.all((V > lo) & (V < hi), axis=1))[0]:
                        w = Vector(V[k]); loc, nr, _, _ = bv.find_nearest(w)
                        if loc is None: continue
                        sd = (w - loc).dot(nr)
                        if sd < 0 and _inside(bv, w): note(r, 'pokeArm' if isarm[bn][k] else 'poke', sd, [act.name, fr, bn, [round(c, 3) for c in w]])
                for w in fm[n][0]:                          # part vertices under the body surface
                    w = Vector(w); loc, nr, face, _ = bt.find_nearest(w)
                    if loc is None or (w - loc).dot(nr) >= 0 or not _inside(bt, w): continue
                    sd = (w - loc).dot(nr); where = [act.name, fr, 'part vertex', [round(c, 3) for c in w]]
                    if armpit_excused(classes[face], tt, loc, -sd):
                        note(r, 'sinkArm', sd, where); r['armpit'].append([act.name, fr, round(sd * 1000, 2), where[3]])
                    else: note(r, 'sink', sd, where)
                if n in shapes:                             # bag shell keeps its shape
                    e, L0 = shapes[n]; V = rig_space(rig, fm[n][0])
                    ch = float(np.abs(np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1) - L0).max())
                    r['bagShape'] = max(r['bagShape'], round(ch * 1000, 2))
                for m, (V, _, _) in fm.items():             # other parts' vertices inside this part
                    if m == n: continue
                    for k in np.nonzero(np.all((V > lo) & (V < hi), axis=1))[0]:
                        w = Vector(V[k]); loc, nr, _, _ = bv.find_nearest(w)
                        if loc is None: continue
                        sd = (w - loc).dot(nr)
                        if sd < -1e-4 and _inside(bv, w):
                            o2 = m.split('_Fit_')[1]; r['overlap'][o2] = min(r['overlap'].get(o2, 0.0), round(sd * 1000, 2))
    return res, hid_idle


def audit(ident, plan):
    row = {'id': ident, 'failures': [],
           'bytes': {'source': (SRC / f'{ident}.glb').stat().st_size, 'shipped': (OUT / f'{ident}.glb').stat().st_size}}
    fail = row['failures'].append
    before, after = contract(SRC / f'{ident}.glb'), contract(OUT / f'{ident}.glb')
    row['contract'] = [list(map(str, p)) for p in contract_problems(ident, before, after, set(plan['remove']))]
    if row['contract']: fail('contract')
    rig, meshes = load(OUT / f'{ident}.glb')
    row['clips'] = sorted(a.name for a in bpy.data.actions)
    if set(row['clips']) != CLIPS: fail('clips')
    row['soleMin'] = soles(rig, meshes)
    if min(row['soleMin'].values()) < LIMIT['sole']: fail('sole')
    body = [o for o in meshes if BODY.match(o.name)]
    fits = sorted((o for o in meshes if o.name.startswith(ident + '_Fit_')), key=lambda o: o.name)
    made = sorted(fit_name(f) for f in fits)
    if made != sorted(plan['add']): fail(f'parts {made} != plan {sorted(plan["add"])}')
    row['skin'] = skin_problems([*fits, *body])
    if row['skin']: fail(f'skin weights {row["skin"]}')
    try:
        floats, hid_rest, shapes = rest_float(ident, rig, meshes, fits, body)
    except AssertionError as e:
        fail(str(e)); row['pass'] = False; return row
    parts, hid_idle = clash(ident, rig, meshes, fits, body, shapes)
    for t, r in parts.items():
        r['float'] = floats[t]
        if -min(r['poke'], r['pokeArm'], r['sink']) > LIMIT['pen'] * 1000: fail(f'{t} penetration')
        if r['overlap']: fail(f'{t} overlap {r["overlap"]}')
        if r.get('bagShape', 0) > LIMIT['bagShape'] * 1000: fail(f'{t} bag shape')
        if r['float']['maxMm'] > LIMIT['reachBag' if t in BAGS else 'reach'] * 1000: fail(f'{t} vertex {r["float"]["maxMm"]} mm off the body (spike)')
        if max(r['float']['median'], r['float'].get('strapMedian', 0)) > LIMIT['float'] * 1000: fail(f'{t} float')
    row['parts'] = parts
    row['hidden'] = {'rest': hid_rest, 'idle0': hid_idle}
    if hid_rest[0] or (hid_idle or [0])[0]: fail('kept front piece hidden')
    row['maxPenetrationMm'] = round(-min([0.0, *(min(r['poke'], r['pokeArm'], r['sink']) for r in parts.values())]), 2)
    row['maxRestFloatMm'] = max([0.0, *(r['float']['median'] for r in parts.values())])
    row['pass'] = not row['failures']
    return row


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    plans_path = Path(argv[argv.index('--plans') + 1]) if '--plans' in argv else ROOT / 'art/wardrobe-fit/plans.json'
    if not plans_path.is_absolute(): plans_path = ROOT / plans_path
    plans = {p['id']: p for p in json.loads(plans_path.read_text())}
    named = [a for a in argv if a.startswith('office-')]
    ids = named or sorted(p.stem for p in OUT.glob('*.glb'))
    missing = [i for i in ids if i not in plans]
    if missing and named: sys.exit(f'no plan for {missing}')
    for i in missing: print('AUDIT SKIP', i, 'no plan in', plans_path, flush=True)
    ids = [i for i in ids if i in plans]
    rows = []
    for ident in ids:
        r = audit(ident, plans[ident]); rows.append(r)
        brief = {t: {'poke': p['poke'], 'arm': p['pokeArm'], 'sink': p['sink'], 'sinkArm': p['sinkArm'],
                     'armpit': len(p['armpit']), 'float': p['float']['median'], **({'bagShape': p['bagShape']} if 'bagShape' in p else {})}
                 for t, p in r.get('parts', {}).items()}
        print('AUDIT', 'PASS' if r['pass'] else 'FAIL', ident, 'pen', r.get('maxPenetrationMm'), 'mm float', r.get('maxRestFloatMm'),
              'mm hidden', r.get('hidden'), 'sole', min(r['soleMin'].values()), json.dumps(brief), r['failures'], flush=True)
    src = sum(r['bytes']['source'] for r in rows); out = sum(r['bytes']['shipped'] for r in rows)
    size = {'ids': len(rows), 'source': src, 'shipped': out, 'ratio': round(out / src, 4), 'limit': LIMIT['size']}
    dest = ROOT / 'art/wardrobe-fit/audit.json'; dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({'limits': LIMIT, 'step': STEP, 'size': size, 'looks': rows}, indent=2, ensure_ascii=False))
    print('SIZE', src, out, size['ratio'], 'PASS' if out <= src * LIMIT['size'] else 'FAIL', flush=True)
    if not all(r['pass'] for r in rows) or out > src * LIMIT['size']: sys.exit(1)


if __name__ == '__main__':
    main()

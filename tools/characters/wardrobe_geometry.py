"""Body-surface geometry for fitted wardrobe parts. All construction is in rest pose, world space.

World axes differ per rig: the female office rig faces -Y with +X as its left, the male
`Human Armature` (under OfficeMale_Normalization) faces +X with +Y as its left. Templates must
never hard-code a direction — use landmarks()['fwd'] / ['left'] (derived from the shoulders).
"""
import bpy, bmesh, math, re
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# Verified against the source snapshots (female rig 33-34 bones, male rig 42 bones).
MALE_BONES = {'neck': 'Neck', 'chest': 'Spine2', 'spine': 'Spine1', 'hips': 'Hips',
              'shoulder.L': 'LeftShoulder', 'shoulder.R': 'RightShoulder', 'upleg.L': 'LeftUpLeg', 'upleg.R': 'RightUpLeg'}
FEMALE_BONES = {'neck': 'Neck', 'chest': 'Torso', 'spine': 'Abdomen', 'hips': 'Hips',
                'shoulder.L': 'Shoulder.L', 'shoulder.R': 'Shoulder.R', 'upleg.L': 'UpperLeg.L', 'upleg.R': 'UpperLeg.R'}
UP = Vector((0, 0, 1))
ARM = re.compile(r'(Arm|Hand|Palm|Finger|Thumb|Index|MiddleHand)')   # arm/hand bones of either rig


UPPER_ARM = re.compile(r'^(UpperArm\.[LR]|LeftArm|RightArm)$')          # upper-arm bones only (no forearm/hand)
ARMPIT_TOUCH = .02   # upper-arm surface this close to the torso leaves no room for a strap stack (gap .007 +
                     # thickness .008 + margin .0015 = 17 mm): the arm has closed on the torso there
ARMPIT_CAP = .025    # deeper than this under an upper arm is a failure, not an armpit


def face_classes(objs):
    """Per polygon of `objs` (concatenated, in order): 'torso', 'upper' (upper arm) or 'lower'
    (forearm, hand). A face is arm when its corners' average arm weight is over .5, and upper arm
    when upper-arm bones carry at least half of that."""
    out = []
    for o in objs:
        names = {g.index: g.name for g in o.vertex_groups}
        arm = [sum(g.weight for g in v.groups if ARM.search(names[g.group])) for v in o.data.vertices]
        up = [sum(g.weight for g in v.groups if UPPER_ARM.match(names[g.group])) for v in o.data.vertices]
        for q in o.data.polygons:
            a = sum(arm[i] for i in q.vertices) / len(q.vertices); u = sum(up[i] for i in q.vertices) / len(q.vertices)
            out.append('torso' if a <= .5 else 'upper' if u >= a / 2 else 'lower')
    return out


def armpit_excused(cls, torso_tree, arm_point, depth):
    """A part vertex `depth` under body face class `cls` is excused only as an armpit: the face is an
    upper-arm face, the arm surface there (`arm_point`, the nearest point on that face) lies within
    ARMPIT_TOUCH of a torso face — the arm has closed on the torso, the body intersects itself and
    nothing lying on the torso can get out — and it is at most ARMPIT_CAP deep. Shared by the
    build's clearance and the audit."""
    if cls != 'upper' or depth > ARMPIT_CAP or torso_tree is None: return False
    hit = torso_tree.find_nearest(arm_point)
    return hit[0] is not None and hit[3] <= ARMPIT_TOUCH


def rest(ctx):
    ctx['rig'].data.pose_position = 'REST'; bpy.context.view_layer.update()


def body_bvh(ctx, objs=None):
    """BVH over the evaluated rest-pose meshes `objs` (default: the body meshes)."""
    rest(ctx); dg = bpy.context.evaluated_depsgraph_get(); verts = []; polys = []
    for o in (ctx['body'] if objs is None else objs):
        ev = o.evaluated_get(dg); me = ev.to_mesh(); off = len(verts)
        verts += [ev.matrix_world @ v.co for v in me.vertices]
        polys += [[off + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def rest_points(ctx, objs):
    """Rest-pose world positions of every vertex of `objs` as an (N, 3) numpy array."""
    import numpy as np
    rest(ctx); dg = bpy.context.evaluated_depsgraph_get(); out = []
    for o in objs:
        ev = o.evaluated_get(dg); me = ev.to_mesh(); co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co); ev.to_mesh_clear()
        M = np.array(ev.matrix_world); out.append(co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3])
    return np.concatenate(out)


def _inside(bvh, w):
    """Ray parity in 2 of 3 directions: is point w inside the closed mesh behind `bvh`?"""
    votes = 0
    for d in (Vector((0, 0, 1)), Vector((.577, .577, .577)), Vector((-.3, .9, -.3)).normalized()):
        n = 0; q = w + d * 1e-5
        for _ in range(30):
            hit = bvh.ray_cast(q, d, 2.0)[0]
            if hit is None: break
            n += 1; q = hit + d * 1e-5
        votes += n % 2
    return votes >= 2


def pose_clearance(ctx, obj, rows, dirs, margin, iters=10, others=()):
    """Skinned `obj` (Armature modifier on) is played through every frame of every clip; where a
    body vertex ends up inside it, the row of vertices (`rows[k]`, index lists) owning the
    pierced face is lifted along rest-pose `dirs[k]` by the depth plus `margin`. Repeats until
    nothing pierces (or `iters` runs out). Skin bunching at a joint moves differently from a
    part lying on it, which a rest-pose offset alone cannot absorb. `others` are fitted garments
    this part lies on: their vertices count like body vertices. The check is two-sided: the part's
    own vertices that end up under the deformed body, or inside one of `others`, lift their rows too
    (a thin layer can sink under a coarse body face without any body vertex entering it). Restores the rig's action, frame, pose
    mode and NLA mutes. Returns the deepest penetration left, in metres."""
    return pose_clearance_many(ctx, [(obj, rows, dirs)], margin, iters, others)


def pose_clearance_many(ctx, items, margin, iters=10, others=()):
    """pose_clearance for several parts at once: `items` is [(obj, rows, dirs)], all checked in
    the same pass over the clip frames. Returns the deepest penetration left over all of them."""
    import numpy as np
    rig = ctx['rig']; ad = rig.animation_data; scene = bpy.context.scene
    saved = (ad.action, ad.action_slot if ad.action else None, scene.frame_current, rig.data.pose_position)
    muted = [t.mute for t in ad.nla_tracks]
    for t in ad.nla_tracks: t.mute = True      # evaluate each clip alone, as the game plays it
    row_ofs = [{v: k for k, vs in enumerate(rows) for v in vs} for _, rows, _ in items]
    invs = [obj.matrix_world.inverted().to_3x3() for obj, _, _ in items]
    sources = [*ctx['body'], *others]
    classes = face_classes(ctx['body'])
    # A part vertex under the body, or a row that skin pierces, is lifted so that in the offending
    # frame it moves out along the posed body normal there (to_rest below). Not the row's own rest
    # direction: a neck roll resting on the rising shoulder slope went deeper along it.
    wts = []                                     # per part vertex: [(bone, weight)] of its skin
    for obj, _, _ in items:
        names = {g.index: g.name for g in obj.vertex_groups}
        wts.append([[(names[g.group], g.weight) for g in v.groups if g.weight > 1e-4 and names[g.group] in rig.pose.bones]
                    for v in obj.data.vertices])
    RW = rig.matrix_world; RWi = RW.inverted()
    worst = 0.0
    for it in range(iters):
        needs = [[0.0] * len(rows) for _, rows, _ in items]; worst = 0.0; rig.data.pose_position = 'POSE'
        sinks = [{} for _ in items]              # row -> (depth, rest lift direction) for vertices under the body
        lifts = [{} for _ in items]              # row -> (depth, rest lift direction) for rows that skin pierces
        for act in sorted(bpy.data.actions, key=lambda a: a.name):
            ad.action = act; ad.action_slot = act.slots[0]; f0, f1 = (int(f) for f in act.frame_range)
            for f in range(f0, f1 + 1):
                scene.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
                skin_m = {}
                def to_rest(wk, d):
                    """Rest-pose lift whose skinned image in this frame is the posed direction `d`.
                    The rigs rest in a T-pose and play with the arms down, so a part vertex carrying
                    shoulder or arm weight turns a rest-space lift by up to 90 degrees: lifted along a
                    rest normal it slides along the skin instead of leaving it (jun, ian, seona)."""
                    A = Matrix(((0.0,) * 3,) * 3)
                    for b, x in wk:
                        if b not in skin_m:
                            pb = rig.pose.bones[b]
                            skin_m[b] = (RW @ pb.matrix @ pb.bone.matrix_local.inverted() @ RWi).to_3x3()
                        A = A + skin_m[b] * x
                    try: r = A.inverted() @ d       # not normalised: a blend of turned bones shrinks
                    except ValueError: return d      # the lift, and the rest lift makes up for it
                    return r if 1e-9 < r.length <= 2 else r.normalized() * 2 if r.length > 2 else d
                clouds = []
                for o in sources:
                    eb = o.evaluated_get(dg); mb = eb.to_mesh(); co = np.empty(len(mb.vertices) * 3)
                    mb.vertices.foreach_get('co', co); eb.to_mesh_clear()
                    M = np.array(eb.matrix_world); clouds.append(co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3])
                cloud = np.concatenate(clouds)
                shells = []                              # (nearest-face tree, parity tree) of the body and of the closed
                BV, BP = [], []                          # garments the part lies on: part vertices under them lift too
                for o in ctx['body']:
                    ev = o.evaluated_get(dg); me = ev.to_mesh(); off = len(BV)
                    BV += [ev.matrix_world @ v.co for v in me.vertices]; BP += [[off + i for i in q.vertices] for q in me.polygons]
                    ev.to_mesh_clear()
                t = BVHTree.FromPolygons(BV, BP); shells.append((t, t))
                TP = [q for q, c in zip(BP, classes) if c == 'torso']
                torso_t = BVHTree.FromPolygons(BV, TP) if TP else None
                for o in others:
                    V, P = [], []
                    ev = o.evaluated_get(dg); me = ev.to_mesh()
                    V = [ev.matrix_world @ v.co for v in me.vertices]; P = [list(p.vertices) for p in me.polygons]; ev.to_mesh_clear()
                    t = BVHTree.FromPolygons(V, P); shells.append((t, t))
                for (obj, rows, dirs), row_of, need, sink, lift, wk in zip(items, row_ofs, needs, sinks, lifts, wts):
                    ev = obj.evaluated_get(dg); me = ev.to_mesh()
                    V = [ev.matrix_world @ v.co for v in me.vertices]; P = [list(p.vertices) for p in me.polygons]
                    ev.to_mesh_clear()
                    lo = np.array([min(c[i] for c in V) for i in range(3)]) - .02; hi = np.array([max(c[i] for c in V) for i in range(3)]) + .02
                    bvh = BVHTree.FromPolygons(V, P)
                    for w in cloud[np.all((cloud > lo) & (cloud < hi), axis=1)]:
                        w = Vector(w); loc, n, face, _ = bvh.find_nearest(w)   # no radius: depth has no blind spot
                        if loc is None or (w - loc).dot(n) >= 0 or not _inside(bvh, w): continue
                        depth = -(w - loc).dot(n); worst = max(worst, depth)
                        out = shells[0][0].find_nearest(w)[1]          # outward from the posed body there
                        for v in P[face]:
                            r = row_of[v]
                            if depth + margin > lift.get(r, (0.0, None))[0]: lift[r] = (depth + margin, to_rest(wk[v], out))
                    for near, par in shells:
                        for k, w in enumerate(V):
                            loc, n, face, _ = near.find_nearest(w)          # no radius, as the audit
                            if loc is None or (w - loc).dot(n) >= 0 or not _inside(par, w): continue
                            depth = -(w - loc).dot(n)
                            if near is shells[0][0] and armpit_excused(classes[face], torso_t, loc, depth): continue
                            worst = max(worst, depth)
                            r = row_of[k]
                            if near is shells[0][0]:   # out through the posed body face above it
                                if depth + margin > sink.get(r, (0.0, None))[0]: sink[r] = (depth + margin, to_rest(wk[k], n))
                            else: need[r] = max(need[r], depth + margin)
        print('STRAP CLEAR' if len(items) == 1 else 'LAYER CLEAR', ','.join(o.name for o, _, _ in items), 'pass', it + 1,
              'deepest %.1f mm' % (worst * 1000), 'rows lifted', len({(i, k) for i, (need, sink, lift) in enumerate(zip(needs, sinks, lifts))
                                                                     for k in [*(k for k, d in enumerate(need) if d), *sink, *lift]}), flush=True)
        if worst == 0.0: break
        for (obj, rows, dirs), inv, need, sink, pierced in zip(items, invs, needs, sinks, lifts):
            for k, d in enumerate(need):
                lift = dirs[k] * d if d else Vector()
                if k in pierced: lift = lift + pierced[k][1] * pierced[k][0]
                if k in sink: lift = lift + sink[k][1] * sink[k][0]
                if lift.length:
                    for v in rows[k]: obj.data.vertices[v].co += inv @ lift
            obj.data.update()
    ad.action = saved[0]
    if saved[1] is not None: ad.action_slot = saved[1]
    for t, m in zip(ad.nla_tracks, muted): t.mute = m
    scene.frame_set(saved[2]); rig.data.pose_position = saved[3]; bpy.context.view_layer.update()
    return worst


# ---------------------------------------------------------------- following the rendered body face
# A part vertex skinned with the body's weights interpolated at its foot point moves with the
# *blended bone matrices*, but the body face under it is rendered as the flat triangle between its
# three separately skinned corners. On the coarse male body (triangles up to ~12 cm, corners on
# Spine / Shoulder / Spine2) the two drift apart by up to ~2 cm in walk, and a lapel sinks under
# the jacket. face_follow() refits each near-surface vertex's weights so that, over the sampled
# clip frames, it tracks its fixed point in the frame of the deformed triangle beneath it.
FOLLOW_REACH = .03    # vertices farther than this from the body keep their weights (a bag's far side)
FOLLOW_STEP = 2       # sample every 2nd frame of every clip
FOLLOW_REG = .002     # weight change of 1 costs as much as this drift (m) in every frame


def _skin_frames(ctx):
    """Cached per look: body rest vertices, triangles, per-vertex weights, and for every sampled
    clip frame the deformed body vertices and each bone's world skinning matrix."""
    import numpy as np
    if '_skin_frames' in ctx: return ctx['_skin_frames']
    rig = ctx['rig']; ad = rig.animation_data; scene = bpy.context.scene
    saved = (ad.action, ad.action_slot if ad.action else None, scene.frame_current, rig.data.pose_position)
    muted = [t.mute for t in ad.nla_tracks]
    for t in ad.nla_tracks: t.mute = True

    def body_verts(dg):
        out = []
        for o in ctx['body']:
            ev = o.evaluated_get(dg); me = ev.to_mesh(); co = np.empty(len(me.vertices) * 3)
            me.vertices.foreach_get('co', co); ev.to_mesh_clear(); M = np.array(ev.matrix_world)
            out.append(co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3])
        return np.concatenate(out)

    rest(ctx); dg = bpy.context.evaluated_depsgraph_get(); V0 = body_verts(dg)
    tris, weights, off = [], [], 0
    for o in ctx['body']:
        me = o.data; me.calc_loop_triangles(); names = {g.index: g.name for g in o.vertex_groups}
        tris += [[off + i for i in t.vertices] for t in me.loop_triangles]
        weights += [{names[g.group]: g.weight for g in v.groups if g.weight > 1e-4} for v in me.vertices]
        off += len(me.vertices)
    bones = [b.name for b in rig.data.bones]
    RW = np.array(rig.matrix_world); RWi = np.linalg.inv(RW)
    local_inv = {b.name: np.linalg.inv(np.array(b.matrix_local)) for b in rig.data.bones}
    frames = []
    rig.data.pose_position = 'POSE'
    for act in sorted(bpy.data.actions, key=lambda a: a.name):
        ad.action = act; ad.action_slot = act.slots[0]; f0, f1 = (int(f) for f in act.frame_range)
        for f in range(f0, f1 + 1, FOLLOW_STEP):
            scene.frame_set(f); bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
            S = {n: RW @ np.array(rig.pose.bones[n].matrix) @ local_inv[n] @ RWi for n in bones}
            frames.append((body_verts(dg), S))
    ad.action = saved[0]
    if saved[1] is not None: ad.action_slot = saved[1]
    for t, m in zip(ad.nla_tracks, muted): t.mute = m
    scene.frame_set(saved[2]); rig.data.pose_position = saved[3]; bpy.context.view_layer.update()
    tris = np.array(tris)
    ctx['_skin_frames'] = (V0, tris, weights, frames, BVHTree.FromPolygons([Vector(v) for v in V0], tris.tolist()))
    return ctx['_skin_frames']


def _tri_frame(c0, c1, c2):
    import numpy as np
    e1, e2 = c1 - c0, c2 - c0; n = np.cross(e1, e2); n /= max(np.linalg.norm(n), 1e-12)
    return e1, e2, n


def _solve_weights(A, t, w0, limit):
    """min |A w - t|^2 + reg |w - w0|^2, sum w = 1, w >= 0, at most `limit` non-zero (active set)."""
    import numpy as np
    reg = A.shape[0] / 3 * FOLLOW_REG ** 2
    act = list(range(A.shape[1]))
    while True:
        a = A[:, act]; k = len(act)
        K = np.zeros((k + 1, k + 1)); K[:k, :k] = 2 * (a.T @ a + reg * np.eye(k)); K[:k, k] = 1; K[k, :k] = 1
        rhs = np.concatenate([2 * (a.T @ t + reg * w0[act]), [1.0]])
        w = np.linalg.lstsq(K, rhs, rcond=None)[0][:k]
        if w.min() < 0 or k > limit:
            act.pop(int(np.argmin(w))); continue
        out = np.zeros(A.shape[1]); out[act] = w; return out


def face_follow(ctx, obj, limit=4, reach=FOLLOW_REACH):
    """Refit the skin weights of `obj`'s vertices within `reach` of the body (rest pose, weights
    already set, rig still in REST) so each follows its point on the deformed body triangle under
    it over every sampled clip frame. Returns (worst drift before, after) in metres."""
    import numpy as np
    V0, tris, bw, frames, bvh = _skin_frames(ctx); rest(ctx)
    mw = obj.matrix_world; groups = {g.index: g.name for g in obj.vertex_groups}
    worst_before = worst_after = 0.0; rewritten = []
    for v in obj.data.vertices:
        p = mw @ v.co; loc, _, ti, d = bvh.find_nearest(p)
        if loc is None or d > reach: continue
        tri = tris[ti]; e1, e2, n = _tri_frame(*V0[tri])
        abh = np.linalg.solve(np.column_stack([e1, e2, n]), np.array(p) - V0[tri[0]])
        cur = {groups[g.group]: g.weight for g in v.groups if g.weight > 0}
        cand = sorted({*cur, *(b for i in tri for b in bw[i])})
        w0 = np.array([cur.get(b, 0.0) for b in cand]); ph = np.append(np.array(p), 1.0)
        A = np.zeros((3 * len(frames), len(cand))); t = np.zeros(3 * len(frames))
        for f, (BV, S) in enumerate(frames):
            c = BV[tri]; f1, f2, fn = _tri_frame(*c)
            t[3 * f:3 * f + 3] = c[0] + abh[0] * f1 + abh[1] * f2 + abh[2] * fn
            for j, b in enumerate(cand): A[3 * f:3 * f + 3, j] = (S[b] @ ph)[:3]
        w = _solve_weights(A, t, w0, limit)
        err = lambda x: float(np.linalg.norm((A @ x - t).reshape(-1, 3), axis=1).max())
        e0, e1_ = err(w0), err(w)
        worst_before = max(worst_before, e0)
        if e1_ >= e0: worst_after = max(worst_after, e0); continue
        worst_after = max(worst_after, e1_); rewritten.append(v.index)
        for gi in [g.group for g in v.groups]: obj.vertex_groups[gi].remove([v.index])   # indices first: removing shifts v.groups
        w = np.where(w > 1e-4, w, 0.0); w /= w.sum()          # drop tiny weights, then sum to 1 again
        for b, x in zip(cand, w):
            if x > 0: obj.vertex_groups[b].add([v.index], float(x), 'REPLACE')
    over = [k for k in rewritten if sum(1 for g in obj.data.vertices[k].groups if g.weight > 0) > limit]
    assert not over, (obj.name, 'more than', limit, 'bones after face_follow', len(over))
    return worst_before, worst_after


def shell_weights(ctx, pieces, contact, limit=1):
    """One weight set for every vertex of `pieces` (a bag's body, pocket, handle, flap), so the bag
    moves as one shell, never bends. `limit=1`: a single bone, the only binding linear blend skinning
    keeps rigid (a blend of two rotating bones scales and shears: 22 mm edge change on jun's hip bag). It is solved like face_follow, jointly over the `contact`
    vertices (world rest positions, the face lying on the body): over every sampled clip frame they
    stay as close as one weight set allows to their points on the deformed triangles beneath them.
    Returns (worst contact drift, the weights)."""
    import numpy as np
    V0, tris, bw, frames, bvh = _skin_frames(ctx); rest(ctx)
    rows, targets, cand = [], [], set()
    for p in contact:
        _, _, ti, _ = bvh.find_nearest(p); tri = tris[ti]; e1, e2, n = _tri_frame(*V0[tri])
        abh = np.linalg.solve(np.column_stack([e1, e2, n]), np.array(p) - V0[tri[0]])
        rows.append((np.append(np.array(p), 1.0), tri, abh)); cand |= {b for i in tri for b in bw[i]}
    cand = sorted(cand); A, t = [], []
    for BV, S in frames:
        for ph, tri, abh in rows:
            c = BV[tri]; f1, f2, fn = _tri_frame(*c)
            t.append(c[0] + abh[0] * f1 + abh[1] * f2 + abh[2] * fn)
            A.append(np.stack([(S[b] @ ph)[:3] for b in cand], axis=1))
    A = np.concatenate(A); t = np.concatenate(t)
    w0 = np.zeros(len(cand))
    for _, tri, _ in rows:
        for i in tri:
            for b, x in bw[i].items(): w0[cand.index(b)] += x
    w0 /= w0.sum()
    w = _solve_weights(A, t, w0, limit); w = np.where(w > 1e-4, w, 0.0); w /= w.sum()
    drift = float(np.linalg.norm((A @ w - t).reshape(-1, 3), axis=1).max())
    weights = {b: float(x) for b, x in zip(cand, w) if x > 0}
    for obj in pieces:
        every = [v.index for v in obj.data.vertices]
        for g in obj.vertex_groups: g.remove(every)
        for b, x in weights.items(): obj.vertex_groups[b].add(every, x, 'REPLACE')
    return drift, weights


def standoff(points, base, out, radius, reach=.15):
    """How far along unit `out` the point cloud rises above `base`, over the cylinder of `radius`
    around the line base + t*out (only points within `reach` count). A face vertex pushed out by
    this plus a gap clears every point of the cloud under its neighbourhood — including thin
    rims (a blouse hem flaring over a skirt) that fall between the rays that placed the grid."""
    import numpy as np
    d = points - np.array(base); a = d @ np.array(out)
    sel = ((d * d).sum(1) - a * a < radius * radius) & (np.abs(a) < reach)
    return float(a[sel].max()) if sel.any() else 0.0


def resample(pts, nrm, n):
    """Polyline (points, normals) resampled to `n` points evenly spaced by arc length."""
    seg = [(pts[k + 1] - pts[k]).length for k in range(len(pts) - 1)]; total = sum(seg)
    out_p, out_n = [], []; k = 0; acc = 0.0
    for q in range(n):
        t = total * q / (n - 1)
        while k < len(seg) - 1 and acc + seg[k] < t: acc += seg[k]; k += 1
        u = min(1.0, (t - acc) / seg[k]) if seg[k] else 0.0
        out_p.append(pts[k].lerp(pts[k + 1], u)); out_n.append(nrm[k].lerp(nrm[k + 1], u).normalized())
    return out_p, out_n


def bone_name(ctx, role):
    return (MALE_BONES if 'Human' in ctx['rig'].name else FEMALE_BONES)[role]


def landmarks(ctx):
    """Bone (head, tail) pairs in world space keyed by role, plus the rig's world axes:
    'fwd' (character front) and 'left' (character left), both unit Vectors perpendicular to +Z."""
    rig = ctx['rig']; names = MALE_BONES if 'Human' in rig.name else FEMALE_BONES
    missing = [b for b in names.values() if b not in rig.data.bones]
    assert not missing, (ctx['id'], 'bone names', missing)
    m = rig.matrix_world
    lm = {k: (m @ rig.data.bones[b].head_local, m @ rig.data.bones[b].tail_local) for k, b in names.items()}
    left = lm['shoulder.L'][1] - lm['shoulder.R'][1]; left.z = 0; left.normalize()
    lm['left'] = left; lm['fwd'] = left.cross(UP).normalized()
    return lm


def surface_point(bvh, p, out, offset):
    """Cast from outside toward the body; the garment sits `offset` above the hit."""
    start = p + out.normalized() * 0.5
    hit, normal, _, _ = bvh.ray_cast(start, -out.normalized(), 1.0)
    assert hit is not None, ('no body surface', tuple(p), tuple(out))
    return hit + normal * offset, normal


def surface_from_inside(bvh, c, out, offset, reach=.25):
    """Cast from a point inside the body (e.g. the neck axis) outward; the nearest wall wins, so
    arms, shoulders or the chin further along the ray can never be picked up."""
    hit, normal, _, _ = bvh.ray_cast(c, out.normalized(), reach)
    assert hit is not None, ('no body wall within reach', tuple(c), tuple(out))
    return hit + normal * offset, normal


def layered_from_inside(bvh, outer, c, d, offset, reach=.4, shell=.08):
    """Like surface_from_inside, but garments lying on the body (hood, skirt, coat hem, vest —
    the `outer` BVH, may be None) count as surface: the outermost `outer` hit within `shell`
    of the body wall wins. Ray from the inside picks the nearest body wall; the outer layer is
    then found by casting back from `shell` beyond it, so far-away parts are never picked up.
    Where no skin exists along the ray (the legs under a skirt are not modelled at the hip),
    the nearest outer-layer wall is the surface."""
    d = d.normalized()
    if outer is not None and bvh.ray_cast(c, d, reach)[0] is None:
        return surface_from_inside(outer, c, d, offset, reach)   # no skin here (e.g. under a skirt)
    p, n = surface_from_inside(bvh, c, d, 0, reach)
    if outer is not None:
        hit, nrm, _, _ = outer.ray_cast(p + d * shell, -d, shell)
        if hit is not None:
            p, n = hit, (nrm if nrm.dot(d) > 0 else -nrm)
    return p + n * offset, n


def _hull2(pts):
    """Convex hull (counter-clockwise) of 2D points, monotone chain."""
    pts = sorted(set(pts))
    def half(seq):
        h = []
        for q in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (q[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(q)
        return h
    lo, hi = half(pts), half(reversed(pts))
    return lo[:-1] + hi[:-1]


def hull_loop(bvh, outer, c, a, b, offset, samples=64, out_n=48, reach=.4, clamp=False):
    """Closed band around the body in the plane through `c` (inside the body) spanned by unit
    vectors a, b. Concavities are bridged like a real strap (2D convex hull of the ray hits),
    then resampled evenly. Returns (points, outward normals, 2D coords) counter-clockwise from +a
    toward +b, index 0 nearest the +a direction. With `clamp`, a ray that finds no wall within
    `reach` (e.g. one running from the torso down into a leg) stops at `reach`; the caller then
    relies on push_out to lift anything left inside the body."""
    b = (b - a * b.dot(a)).normalized(); flat = []
    for k in range(samples):
        ang = k / samples * math.tau
        d = a * math.cos(ang) + b * math.sin(ang)
        if clamp and bvh.ray_cast(c, d, reach)[0] is None: p = c + d * reach
        else: p, _ = layered_from_inside(bvh, outer, c, d, 0, reach)
        flat.append(((p - c).dot(a), (p - c).dot(b)))
    hull = _hull2(flat); n = len(hull)
    seg = [math.dist(hull[i], hull[(i + 1) % n]) for i in range(n)]; total = sum(seg)
    start = max(range(n), key=lambda i: hull[i][0] / (math.hypot(*hull[i]) or 1))   # nearest +a
    res = []; i = start; acc = 0.0; step = total / out_n; target = 0.0
    while len(res) < out_n:
        j = (i + 1) % n
        if acc + seg[i] >= target:
            u = (target - acc) / seg[i] if seg[i] else 0
            res.append((hull[i][0] + (hull[j][0] - hull[i][0]) * u, hull[i][1] + (hull[j][1] - hull[i][1]) * u)); target += step
        else:
            acc += seg[i]; i = j
    pts, nrm = [], []
    for k, (x, y) in enumerate(res):
        px, py = res[k - 1]; nx, ny = res[(k + 1) % out_n]; tx, ty = nx - px, ny - py
        l = math.hypot(tx, ty) or 1; ox, oy = ty / l, -tx / l             # ccw loop: outward is right of tangent
        nv = (a * ox + b * oy).normalized(); pts.append(c + a * x + b * y + nv * offset); nrm.append(nv)
    return pts, nrm, res


def _squircle(s, t, p):
    """Map the square [-1,1]^2 onto the superellipse |x|^p + |y|^p <= 1 (rounded corners)."""
    r = max(abs(s), abs(t))
    if r == 0: return 0.0, 0.0
    k = r / (abs(s) ** p + abs(t) ** p) ** (1 / p)
    return s * k, t * k


def pillow(name, sample, depth, cols=7, rows=9, round_p=4.0, smooth=False):
    """Soft bag body. `sample(u, v)` gives the front-face point and the outward direction for
    (u, v) in a rounded-corner square; the back face is pushed `depth(u, v)` along it and the
    rims are closed with side walls. `smooth` shades it smooth (and lets glTF share vertices)."""
    bm = bmesh.new(); F = []; B = []
    for j in range(rows):
        fr, br = [], []
        for i in range(cols):
            u, v = _squircle(-1 + 2 * i / (cols - 1), -1 + 2 * j / (rows - 1), round_p)
            p, out = sample(u, v)
            fr.append(bm.verts.new(p)); br.append(bm.verts.new(p + out * depth(u, v)))
        F.append(fr); B.append(br)
    for j in range(rows - 1):
        for i in range(cols - 1):
            bm.faces.new((F[j][i], F[j + 1][i], F[j + 1][i + 1], F[j][i + 1]))
            bm.faces.new((B[j][i], B[j][i + 1], B[j + 1][i + 1], B[j + 1][i]))
    ring = ([(0, i) for i in range(cols)] + [(j, cols - 1) for j in range(1, rows)] +
            [(rows - 1, i) for i in range(cols - 2, -1, -1)] + [(j, 0) for j in range(rows - 2, 0, -1)])
    for (j0, i0), (j1, i1) in zip(ring, ring[1:] + ring[:1]):
        bm.faces.new((F[j0][i0], F[j1][i1], B[j1][i1], B[j0][i0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for poly in me.polygons: poly.use_smooth = smooth
    return link(name, me)


def link(name, me):
    obj = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(obj); return obj


def ribbon(name, pts, width, normals, closed=False, smooth=False):
    """Quad strip through `pts`, spread across the surface (perpendicular to the path and the normal)."""
    bm = bmesh.new(); rows = []; n = len(pts)
    for i, (p, nr) in enumerate(zip(pts, normals)):
        if closed: t = pts[(i + 1) % n] - pts[i - 1]
        else: t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        side = t.normalized().cross(nr).normalized() * (width / 2)
        rows.append((bm.verts.new(p - side), bm.verts.new(p + side)))
    pairs = zip(rows, rows[1:] + rows[:1]) if closed else zip(rows, rows[1:])
    for a, b in pairs: bm.faces.new((a[0], a[1], b[1], b[0]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    if smooth:
        for poly in me.polygons: poly.use_smooth = True
    return link(name, me)


def tube(name, pts, radius, sides=6, closed=False):
    """Polyline swept by a `sides`-gon; open tubes get capped ends. Built directly in bmesh
    (no curve convert) so no helper datablocks or objects are left behind."""
    bm = bmesh.new(); rings = []; n = len(pts)
    prev_side = None
    for i, p in enumerate(pts):
        if closed: t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        else: t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        ref = prev_side if prev_side is not None else (UP if abs(t.dot(UP)) < .9 else Vector((1, 0, 0)))
        a = (ref - t * ref.dot(t)).normalized(); b = t.cross(a); prev_side = a
        rings.append([bm.verts.new(p + (a * math.cos(k / sides * math.tau) + b * math.sin(k / sides * math.tau)) * radius) for k in range(sides)])
    pairs = zip(rings, rings[1:] + rings[:1]) if closed else zip(rings, rings[1:])
    for r0, r1 in pairs:
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for poly in me.polygons: poly.use_smooth = True
    return link(name, me)


def plate(name, outline, normal, thickness):
    """Flat n-gon (world-space outline) extruded `thickness` along `normal`, centred on the outline."""
    bm = bmesh.new(); vs = [bm.verts.new(p - normal * thickness / 2) for p in outline]
    face = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=normal * thickness)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return link(name, me)


def push_out(bvh, obj, gap):
    """Move any vertex that sits inside the body (or closer than `gap` to it) out to `gap` above
    the nearest body surface. Construction samples the surface sparsely; this is the guard that
    guarantees nothing sinks between samples. Returns the number of vertices moved."""
    mw = obj.matrix_world; inv = mw.inverted(); moved = 0
    for v in obj.data.vertices:
        w = mw @ v.co; loc, nrm, _, _ = bvh.find_nearest(w)
        if loc is not None and (w - loc).dot(nrm) < gap:
            v.co = inv @ (loc + nrm * gap); moved += 1
    obj.data.update(); return moved


def finish(ctx, obj, material, thickness, max_distance=.15, rigid=None, fill=None, max_influences=None):
    """Solidify (applied), assign `material`, parent to the rig and bind with body skin weights.
    Weights are transferred from the *evaluated* body, so the rig must be in rest pose here —
    a posed body would hand the part the weights of whatever limb moved nearest to it.
    `max_distance` bounds that transfer. `rigid` ({bone: weight}, or a callable giving that dict
    for a vertex's world position) skips the transfer and binds the vertices to those bones instead — for stiff bodies standing off the skin (bags), which
    must not stretch with whichever limb happens to be nearest. `fill` ({bone: weight}) tops up
    vertices whose transferred weight falls short of 1 (e.g. strap ends reaching a bag that is
    bound rigidly to those bones, where no skin lies within `max_distance`). `max_influences`
    caps bones per vertex (glTF writes 4) for parts checked against clip poses before export."""
    rest(ctx); bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    if thickness:
        mod = obj.modifiers.new('Thick', 'SOLIDIFY'); mod.thickness = thickness; mod.offset = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.clear(); obj.data.materials.append(material)
    for b in ctx['rig'].data.bones: obj.vertex_groups.new(name=b.name)
    obj.parent = ctx['rig']; obj.matrix_parent_inverse = ctx['rig'].matrix_world.inverted()
    for src in ([] if rigid else ctx['body']):
        # max_distance keeps a far body mesh (e.g. LegsShoes under a neck part) from adding its
        # nearest-face weights; normalize_all then evens out overlap where two meshes are close.
        dt = obj.modifiers.new('Weights', 'DATA_TRANSFER'); dt.object = src; dt.use_vert_data = True
        dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
        dt.use_max_distance = True; dt.max_distance = max_distance
        dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'; dt.mix_mode = 'ADD'
        bpy.ops.object.modifier_apply(modifier=dt.name)
    if callable(rigid):
        mw = obj.matrix_world
        for v in obj.data.vertices:
            for bone, w in rigid(mw @ v.co).items(): obj.vertex_groups[bone].add([v.index], w, 'REPLACE')
    elif rigid:
        every = [v.index for v in obj.data.vertices]
        for bone, w in rigid.items(): obj.vertex_groups[bone].add(every, w, 'REPLACE')
    if fill:
        for v in obj.data.vertices:
            short = 1 - sum(g.weight for g in v.groups)
            if short > .001:
                for bone, w in fill.items(): obj.vertex_groups[bone].add([v.index], w * short, 'ADD')
    if max_influences:   # glTF keeps 4 joints per vertex: limit here so pose checks see the exported skinning
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=max_influences)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    unweighted = [v.index for v in obj.data.vertices if sum(g.weight for g in v.groups) < .999]
    assert not unweighted, (ctx['id'], obj.name, 'vertices without skin weight', len(unweighted),
                            [tuple(round(c, 3) for c in obj.matrix_world @ obj.data.vertices[k].co) for k in unweighted[:4]])
    if not rigid:   # rigid bag pieces get one shared weight set per bag instead (shell_weights)
        before, after = face_follow(ctx, obj)
        print('FOLLOW', obj.name, 'worst drift %.1f -> %.1f mm' % (before * 1000, after * 1000), flush=True)
    obj.modifiers.new('Rig', 'ARMATURE').object = ctx['rig']
    obj.select_set(False)
    ctx['rig'].data.pose_position = 'POSE'
    return obj

"""Build 26 female OfficeLooks from supplied Quaternius meshes and approved baked rig.
History only: inputs live outside the repo. Current wardrobe source of truth is wardrobe_fit.py.
Run Blender --background --disable-autoexec --python tools/characters/build_female_catalog.py.
The authoritative female OfficeLooks snapshot is refreshed via local npx tsx.
"""
import bpy,bmesh,json,math,sys,subprocess
from pathlib import Path
from mathutils import Matrix,Vector
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from office_wardrobe import fabric,author_motion,hand_props,sweep_bounds
BASE=ROOT/'art/characters/supplied-bases/women'
OUT=ROOT/'art/characters/office-catalog/female';OUT.mkdir(parents=True,exist_ok=True)
PUBLIC=ROOT/'public/assets/characters/office';PUBLIC.mkdir(parents=True,exist_ok=True)
# Always rebuild from the authoritative TypeScript registry, including extended looks.
subprocess.run(['npx','tsx','-e',
    'import {OFFICE_LOOKS} from "./src/game/three/office-looks"; import {writeFileSync} from "node:fs"; writeFileSync("art/characters/office-catalog/female/looks.json", JSON.stringify(OFFICE_LOOKS.filter(x=>x.bodyType==="female"),null,2));'],cwd=str(ROOT),check=True)
looks=json.loads((OUT/'looks.json').read_text())
if '--' in sys.argv:
    ids=sys.argv[sys.argv.index('--')+1:];looks=[l for l in looks if l['id'] in ids]
def canon(n):return n.split('.')[0]
def linear(h):
    h=h.lstrip('#');v=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return [x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v]
def material(n,c):
    m=bpy.data.materials.new(n);m.use_nodes=True;m.node_tree.nodes.clear()
    s=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');o=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(s.outputs['BSDF'],o.inputs['Surface'])
    s.inputs['Base Color'].default_value=(*linear(c),1);s.inputs['Roughness'].default_value=.8;m.diffuse_color=(*linear(c),1)
    return m
def point(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
reports=[]
for look in looks:
    ident=look['id'];print('BUILD',ident,flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/characters/eunchae-office/eunchae-office.blend'))
    rig=next(o for o in bpy.data.objects if o.type=='ARMATURE');root=rig.parent
    actions={n:bpy.data.actions[n] for n in ('idle','walk','sit')}
    for o in list(bpy.data.objects):
        if o not in [rig,root]:bpy.data.objects.remove(o,do_unlink=True)
    root.name=ident;root.scale=(1,1,1);root.location=(0,0,0);rig.name=ident+'_Rig'
    rig.animation_data.action=actions['idle'];bpy.context.scene.frame_set(0)
    sources={}
    for key in ['Alternative','Casual','Dress']:
        with bpy.data.libraries.load(str(BASE/f'Smooth_Female_{key}.blend'),link=False)as(src,dst):dst.objects=['Female']
        sources[key]=dst.objects[0]
    parts=[]
    def part(src,name,keep):
        ob=sources[src].copy();ob.data=ob.data.copy();ob.name=ident+'_'+name;bpy.context.collection.objects.link(ob)
        bm=bmesh.new();bm.from_mesh(ob.data)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if not keep(canon(ob.data.materials[f.material_index].name),f.calc_center_median())],context='FACES')
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS');bm.to_mesh(ob.data);bm.free()
        ob.parent=rig;ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=Matrix.Identity(4)
        for m in ob.modifiers:
            if m.type=='ARMATURE':m.object=rig
        for p in ob.data.polygons:p.use_smooth=True
        parts.append(ob);return ob
    skirt=look.get('lower')=='skirt';long=skirt and look.get('skirtLength')!='knee'
    casual=look['outfit'] in ['blouse','vest']
    top=part('Casual' if casual else 'Alternative','Top',lambda m,p:m not in ['Hair','HairBase','Pants','Socks','Shoes'] and not(m=='Skin' and p.z<2) and not(skirt and m=='Shirt' and p.z<2.62))
    if skirt:
        lower=part('Dress','ContinuousSkirt',lambda m,p:m=='Dress' and p.z<2.70)
        for v in lower.data.vertices:
            t=max(0,min(1,(2.65-v.co.z)/(2.65-1.826)));v.co.z-=(.88 if long else .70)*t;v.co.x*=1-.06*t
            inset=1-.10*max(0,min(1,(v.co.z-2.25)/.4));v.co.x*=inset;v.co.y*=inset
        lower.vertex_groups.clear();g={n:lower.vertex_groups.new(name=n)for n in ['Abdomen','OfficeSkirtUpper','OfficeSkirtLower']}
        for v in lower.data.vertices:
            u=max(0,min(1,(2.55-v.co.z)/.5));l=max(0,min(1,(1.6-v.co.z)/.5))*u
            for n,w in [('Abdomen',1-u),('OfficeSkirtUpper',u-l),('OfficeSkirtLower',l)]:
                if w:g[n].add([v.index],w,'REPLACE')
        part('Dress','LegsShoes',lambda m,p:m=='Shoes'or(m=='Skin' and p.z<(1.05 if long else 1.25)))
    else:
        lower=part('Casual','TrousersShoes',lambda m,p:m in ['Pants','Socks','Shoes']or(m=='Skin' and p.z<.3))
        if look.get('lower')=='wide':
            for v in lower.data.vertices:
                if .24<v.co.z<2.15:
                    center=.31 if v.co.x>0 else -.31;t=max(0,1-v.co.z/2.15);v.co.x=center+(v.co.x-center)*(1+.75*t);v.co.y*=1+.30*t
    coat_hem=None
    if look['outfit'] in ['coat','labcoat']:
        # Recolor and ease the supplied continuous forearm skin surface into a
        # complete sleeve; retain hands and fingers as skin at the wrist boundary.
        jacket_slot=next(i for i,m in enumerate(top.data.materials) if canon(m.name)=='Jacket')
        sleeve_vertices=set()
        for poly in top.data.polygons:
            if canon(top.data.materials[poly.material_index].name)!='Skin':continue
            arm=sum(g.weight for i in poly.vertices for g in top.data.vertices[i].groups if top.vertex_groups[g.group].name in ['LowerArm.L','LowerArm.R','UpperArm.L','UpperArm.R'])/len(poly.vertices)
            if arm>.68:poly.material_index=jacket_slot;sleeve_vertices.update(poly.vertices)
        for i in sleeve_vertices:
            v=top.data.vertices[i];v.co.y*=1.08;v.co.z=3.59+(v.co.z-3.59)*1.045
        # Supplied dress side/back geometry forms an open coat hem, with averaged
        # thigh deformation. The open front is intentional; no trouser-leg split.
        # Continuous open-front rings avoid disconnected source-face cutouts.
        # Ease the lower shell beyond the animated skirt/shirt underlayer.
        # The previous tight ellipse exposed the underlayer at the rear hem.
        rings=[(3.05,.40,.385),(2.80,.445,.47),(2.43,.50,.56),(1.70 if look['outfit']=='labcoat' else 1.85,.55,.65)]
        verts=[];faces=[];segments=20
        for z,rx,ry in rings:
            for i in range(segments+1):
                theta=math.radians(38+(360-76)*i/segments)
                # Skirt volume needs rear-quarter ease, away from hanging hands.
                rear_ease=1+.25*max(0,-math.cos(theta)) if skirt else 1
                verts.append((rx*math.sin(theta)*rear_ease,-ry*math.cos(theta),z))
        for ring in range(len(rings)-1):
            for i in range(segments):
                a=ring*(segments+1)+i;b=a+segments+1;faces.append((a,b,b+1,a+1))
        data=bpy.data.meshes.new(ident+'_CoatHem');data.from_pydata(verts,[],faces);data.update()
        coat_hem=bpy.data.objects.new(ident+'_CoatHem',data);bpy.context.collection.objects.link(coat_hem);coat_hem.parent=rig;coat_hem.modifiers.new('Rig','ARMATURE').object=rig;parts.append(coat_hem)
        for p in data.polygons:p.use_smooth=True
        coat_hem.vertex_groups.clear();groups={n:coat_hem.vertex_groups.new(name=n)for n in ['Abdomen','Hips','OfficeSkirtUpper','OfficeSkirtLower']}
        for v in coat_hem.data.vertices:
            upper=max(0,min(1,(2.55-v.co.z)/.5));lower=max(0,min(1,(1.6-v.co.z)/.5))*upper
            front=max(0,min(1,(-v.co.y+.05)/.35))
            for n,w in [('Abdomen',1-upper),('Hips',upper*(1-front)),('OfficeSkirtUpper',(upper-lower)*front),('OfficeSkirtLower',lower*front)]:
                if w:groups[n].add([v.index],w,'REPLACE')
    hair=part('Casual' if look['hairStyle'] in ['bob','long','wave','curls'] else 'Alternative','Hair_'+look['hairStyle'],lambda m,p:m in ['Hair','HairBase'])
    for v in hair.data.vertices:
        t=max(0,(4.4-v.co.z)/.5)
        if look['hairStyle']=='long':v.co.z-=.70*t;v.co.y+=.09*t
        if look['hairStyle']=='wave':v.co.z-=.20*t;v.co.x*=1+.18*t;v.co.x+=.04*math.sin(v.co.z*18)*t
        if look['hairStyle']=='curls':v.co.x*=1.2;v.co.x+=.025*math.sin(v.co.z*45);v.co.y+=.025*math.sin(v.co.x*60)
    palette={'Skin':look['skin'],'Eyes':'#292923','Eyebrows':look['hair'],'Hair':look['hair'],'HairBase':look['hair'],'Shirt':look['coat'] if look['outfit']=='hoodie' else look['shirt'],'Jacket':look['coat'],'LightJacket':look['coat'],'Dress':look['trousers'],'Pants':look['trousers'],'Socks':look['shoes'],'Shoes':look['shoes']}
    mats={n:material(ident+'_'+n,c)for n,c in palette.items()}
    for ob in parts:
        for i,m in enumerate(ob.data.materials):ob.data.materials[i]=mats.get(canon(m.name),mats['Shirt'])
    if coat_hem:
        coat_hem.data.materials.clear();coat_hem.data.materials.append(mats['Jacket'])
        for p in coat_hem.data.polygons:p.material_index=0
    def shape(name,loc,scale,mat,bone='Head',kind='sphere',rot=None):
        if kind=='cube':bpy.ops.mesh.primitive_cube_add(size=2)
        elif kind=='torus':bpy.ops.mesh.primitive_torus_add(major_radius=1,minor_radius=.09,major_segments=16,minor_segments=6)
        else:bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8)
        ob=bpy.context.object;ob.name=ident+'_'+name
        transform=Matrix.Translation(Vector(loc))@(rot.to_matrix().to_4x4() if rot else Matrix.Identity(4))@Matrix.Diagonal(Vector((*scale,1)))
        ob.data.transform(transform);ob.data.materials.append(mat);ob.parent=rig;ob.vertex_groups.new(name=bone).add(list(range(len(ob.data.vertices))),1,'REPLACE');ob.modifiers.new('Rig','ARMATURE').object=rig
        for p in ob.data.polygons:p.use_smooth=kind!='cube'
        parts.append(ob);return ob
    hs=look['hairStyle']
    if hs=='curls':
        for side in [-1,1]:
            for i in range(6):shape('Curl',(.265*side,.06+.13*math.sin(i*1.8),4.47-i*.075),(.095,.095,.11),mats['Hair'])
        for i in range(5):shape('CrownCurl',((i-2)*.10,.13,4.61),(.10,.13,.10),mats['Hair'])
    if hs=='bun':shape('Bun',(0,.40,4.56),(.23,.23,.24),mats['Hair'])
    if hs=='pony':
        shape('PonyTie',(0,.39,4.40),(.13,.12,.13),mats['Jacket']);shape('Ponytail',(0,.52,4.00),(.17,.21,.49),mats['Hair'])
    if hs=='braids':
        for side in [-1,1]:
            for i in range(8):shape('Braid',(.23*side+math.sin(i*2)*.025,.22,4.25-i*.115),(.09,.09,.105),mats['Hair'])
    if look['outfit']=='hoodie':
        shape('Hood',(0,.29,3.75),(.34,.22,.28),mats['Jacket'],'Torso')
        cord=material(ident+'_Cord',look['shirt'])
        for x in [-.11,.11]:shape('Drawstring',(x,-.32,3.55),(.012,.012,.18),cord,'Torso',kind='cube')
    if look['outfit']=='vest':
        # Source shirt supplies intact sleeves; fitted sleeveless vest overlays torso.
        vest=part('Casual','Vest',lambda m,p:m=='Shirt' and abs(p.x)<.43 and p.z<3.76)
        vest.data.materials.clear();vest.data.materials.append(mats['Jacket'])
        for p in vest.data.polygons:p.material_index=0
        for v in vest.data.vertices:v.co.x*=1.025;v.co.y*=1.05
    if look['outfit'] in ['suit','double-breasted','coat','labcoat']:
        # Tailored lapels distinguish outerwear from the source cardigan.
        for side in [-1,1]:
            verts=[(side*.12,-.25,3.80),(side*.32,-.32,3.60),(side*.16,-.35,3.42),(side*.045,-.34,3.14)]
            me=bpy.data.meshes.new('Lapel');me.from_pydata(verts,[],[(0,1,2),(0,2,3)]);me.materials.append(mats['Jacket'])
            ob=bpy.data.objects.new(ident+'_Lapel',me);bpy.context.collection.objects.link(ob);ob.parent=rig;ob.vertex_groups.new(name='Torso').add(list(range(4)),1,'REPLACE');ob.modifiers.new('Rig','ARMATURE').object=rig;parts.append(ob)
    if look['outfit']=='double-breasted':
        for x in [-.17,.17]:
            for z in [2.90,3.12,3.34]:shape('Button',(x,-.325,z),(.032,.018,.032),mats['Shoes'],'Torso')
    neck=look.get('neckwear')
    if neck:
        shape('Neckwear',(0,.04,3.83),(.24,.23,.10),mats['Jacket'] if neck=='turtleneck' else mats['Shirt'],'Neck')
        if neck in ['scarf','bow']:
            for x in [-.10,.10]:shape(neck,(x,-.27,3.68),(.15,.055,.09 if neck=='bow' else .22),mats['Jacket'],'Torso')
    if look.get('glasses'):
        from mathutils import Euler
        for x in [-.12,.12]:shape('Glasses',(x,-.245,4.30),(.105,.083,.08),mats['Shoes'],kind='torus',rot=Euler((math.pi/2,0,0)))
        shape('GlassesBridge',(0,-.245,4.30),(.045,.018,.018),mats['Shoes'],kind='cube')
    bag=look.get('bag')
    if bag:
        if bag=='backpack':
            shape('Backpack',(0,.43,3.03),(.34,.19,.43),mats['Shoes'],'Torso',kind='cube')
            for x in [-.26,.26]:shape('BackpackStrap',(x,-.29,3.29),(.033,.022,.40),mats['Shoes'],'Torso',kind='cube')
        elif bag=='briefcase':pass # hand-bound after reference normalization
        else:
            shape('ShoulderBag',(.57,.04,2.45),(.18,.18,.30),mats['Shoes'],'Hips',kind='cube')
            shape('BagStrap',(.47,.025,3.05),(.027,.025,.54),mats['Shoes'],'Torso',kind='cube')
    acc=look.get('accessory')
    if acc=='badge':
        shape('Badge',(.20,-.326,3.28),(.075,.015,.11),mats['Shirt'],'Torso',kind='cube');shape('BadgeLanyard',(.20,-.30,3.52),(.012,.012,.14),mats['Shoes'],'Torso',kind='cube')
    # Notebooks are constructed in animated palm space below.
    if acc=='headset':
        for x in [-.28,.28]:shape('HeadsetEar',(x,.065,4.28),(.075,.13,.13),mats['Shoes'])
        shape('HeadsetMic',(-.21,-.22,4.12),(.025,.18,.025),mats['Shoes'])
    motion_report=author_motion(rig,actions,look,'female')
    bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
    vs=[o.matrix_world@v.co for o in parts for v in o.evaluated_get(dg).data.vertices];mn=min(v.z for v in vs);mx=max(v.z for v in vs)
    scale=1.9/(mx-mn);root.scale=(scale*look['build'],scale,scale);root.location.z=-mn*scale
    # glTF converts Blender -Y forward to +Z; retain supplied facing.
    scene=bpy.context.scene;scene.render.fps=24;scene.frame_start=0;scene.frame_end=100
    # Correct floor penetration using only the common skeleton root's vertical
    # translation in walk. The standing normalization and idle/sit are unchanged.
    # A quarter-frame sole sweep and adjacent-interval envelope keep linearly
    # interpolated exports clear of the floor, including the loop boundary.
    shoe_vertices={o:[i for p in o.data.polygons if o.data.materials[p.material_index]==mats['Shoes'] for i in p.vertices] for o in parts}
    shoe_vertices={o:set(ids) for o,ids in shoe_vertices.items() if ids}
    def sole_height(frame):
        scene.frame_set(int(frame),subframe=frame%1);bpy.context.view_layer.update()
        depsgraph=bpy.context.evaluated_depsgraph_get()
        return min((o.matrix_world@o.evaluated_get(depsgraph).data.vertices[i].co).z for o,ids in shoe_vertices.items() for i in ids)
    rig.animation_data.action=actions['walk'];motion_root=rig.pose.bones['Bone']
    samples=[sole_height(i/4) for i in range(101)]
    original_locations=[]
    for frame in range(26):
        scene.frame_set(frame);original_locations.append(motion_root.location.copy())
    corrections=[]
    for frame in range(26):
        nearby=[samples[i] for i in range(101) if min(abs(i/4-frame),25-abs(i/4-frame))<=1]
        deficit=max(0,-min(nearby));corrections.append(deficit+.00015 if deficit>0 else 0)
    rest_inverse=motion_root.bone.matrix_local.to_3x3().inverted()
    for frame,correction in enumerate(corrections):
        scene.frame_set(frame)
        motion_root.location=original_locations[frame]+rest_inverse@Vector((0,0,correction/scale))
        motion_root.keyframe_insert('location',frame=frame)
    for layer in actions['walk'].layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    if curve.data_path==motion_root.path_from_id('location'):
                        for key in curve.keyframe_points:key.interpolation='LINEAR'
    corrected=[sole_height(i/4) for i in range(101)]
    ground_report={'samples':101,'beforeMin':min(samples),'afterMin':min(corrected),'maxRootLift':max(corrections)}
    assert min(corrected)>=-.00002, (ident,ground_report)
    rig.animation_data.action=actions['idle'];scene.frame_set(0);bpy.context.view_layer.update()
    prop_report=hand_props(rig,actions,look,'female',mats['Shoes'] if look.get('bag')=='briefcase' else mats['Jacket'],mats['Shirt'],parts)
    pattern_materials=[mats['Shirt']] if look['outfit']=='blouse' else [mats['Jacket'],mats['LightJacket']]
    if look['outfit'] in ['suit','double-breasted']:pattern_materials.append(mats['Pants'])
    pattern_files=fabric(look,parts,pattern_materials,OUT)
    bounds_sweep=sweep_bounds(rig,actions,parts,{mats['Shoes']})
    for a in list(bpy.data.actions):
        if a not in actions.values():bpy.data.actions.remove(a)
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root,rig,*parts]:o.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(PUBLIC/(ident+'.glb')),export_format='GLB',use_selection=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_force_sampling=True,export_frame_range=False,export_bake_animation=False,export_anim_slide_to_zero=True,export_morph_animation=False,export_cameras=False,export_lights=False)
    scene.render.engine='CYCLES';scene.cycles.samples=12;scene.render.resolution_x=320;scene.render.resolution_y=400;scene.render.resolution_percentage=100;scene.world.color=(.35,.35,.35);scene.view_settings.view_transform='AgX'
    for n,loc,power,size in [('Key',(-3,-4,5),450,4),('Fill',(3,-2,3),220,3),('Rim',(0,3,4),450,3)]:
        d=bpy.data.lights.new(n,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(n,d);scene.collection.objects.link(o);o.location=loc;point(o,(0,0,1))
    bpy.ops.mesh.primitive_plane_add(size=200);bpy.context.object.data.materials.append(material('Studio','#d9d3c5'))
    bpy.ops.object.camera_add(location=(2,-6,2.8));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=2.3;point(cam,(0,0,1));scene.camera=cam
    report={'id':ident,'bodyType':'female','parts':[o.name for o in parts],'walkGroundContact':ground_report,'motion':motion_report,'handProp':prop_report,'fabricFiles':pattern_files,'quarterFrameBounds':bounds_sweep,'bounds':{}}
    for clip in ['idle','walk','sit']:
        rig.animation_data.action=actions[clip];scene.frame_set(7 if clip=='walk' else 0);bpy.context.view_layer.update()
        scene.render.filepath=str(OUT/(ident+'-'+clip+'.png'));bpy.ops.render.render(write_still=True)
        vs=[o.matrix_world@v.co for o in parts for v in o.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.vertices];report['bounds'][clip]={'min':[min(v[i]for v in vs)for i in range(3)],'max':[max(v[i]for v in vs)for i in range(3)]}
    (OUT/(ident+'.json')).write_text(json.dumps(report,indent=2));reports.append(report)
(OUT/'build-report.json').write_text(json.dumps([json.loads(p.read_text()) for p in sorted(OUT.glob('office-*.json'))],indent=2))

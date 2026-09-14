"""Build Eunchae from the user-supplied Quaternius female collection.

Blender --background --disable-autoexec --python tools/characters/build_supplied_eunchae.py
No MPFB geometry or animation is used in this model.
"""
import bpy
import bmesh
import math
import json
from pathlib import Path
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'art/characters/supplied-bases/women'
OUT=ROOT/'art/characters/eunchae-office'
OUT.mkdir(parents=True,exist_ok=True)
PUBLIC=ROOT/'public/assets/characters'
bpy.ops.wm.open_mainfile(filepath=str(BASE/'Smooth_Female_Alternative.blend'))
source=bpy.data.objects['HumanArmature']
for track in list(source.animation_data.nla_tracks):source.animation_data.nla_tracks.remove(track)
source_actions={key:bpy.data.actions[name] for key,name in [('idle','Female_Idle'),('walk','Female_Walk'),('sit','Female_Sitting')]}
original=bpy.data.objects['Female']
rig=source.copy();rig.data=source.data.copy();rig.name='Eunchae_Office_Rig'
bpy.context.collection.objects.link(rig);rig.animation_data_clear()
for bone in rig.pose.bones:
    for constraint in list(bone.constraints):bone.constraints.remove(constraint)
# A continuous two-segment skirt rig avoids splitting cloth into left/right
# trouser legs when the source knees bend. Both segments follow averaged legs.
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
upper=rig.data.edit_bones.new('OfficeSkirtUpper')
upper.head=(rig.data.edit_bones['UpperLeg.L'].head+rig.data.edit_bones['UpperLeg.R'].head)/2
upper.tail=(rig.data.edit_bones['UpperLeg.L'].tail+rig.data.edit_bones['UpperLeg.R'].tail)/2
upper.parent=rig.data.edit_bones['Hips']
lower=rig.data.edit_bones.new('OfficeSkirtLower');lower.head=upper.tail
lower.tail=(rig.data.edit_bones['LowerLeg.L'].tail+rig.data.edit_bones['LowerLeg.R'].tail)/2
lower.parent=upper;lower.use_connect=True
bpy.ops.object.mode_set(mode='OBJECT')

def canon(name):
    return name.split('.')[0]

def load_mesh(filename):
    with bpy.data.libraries.load(str(BASE/filename),link=False) as (src,dst):dst.objects=['Female']
    return dst.objects[0]

def part(obj,name,keep):
    ob=obj.copy();ob.data=obj.data.copy();ob.name=name
    bpy.context.collection.objects.link(ob)
    bm=bmesh.new();bm.from_mesh(ob.data)
    discard=[f for f in bm.faces if not keep(canon(ob.data.materials[f.material_index].name),f)]
    bmesh.ops.delete(bm,geom=discard,context='FACES')
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
    bm.to_mesh(ob.data);bm.free()
    ob.parent=rig;ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=Matrix.Identity(4)
    for mod in ob.modifiers:
        if mod.type=='ARMATURE':mod.object=rig
    for poly in ob.data.polygons:poly.use_smooth=True
    return ob

casual=load_mesh('Smooth_Female_Casual.blend')
dress=load_mesh('Smooth_Female_Dress.blend')
parts=[
    part(original,'Eunchae_Body_Cardigan',lambda mat,f:mat not in {'Hair','HairBase','Pants','Socks','Shoes'} and not (mat=='Shirt' and f.calc_center_median().z<2.62)),
    part(casual,'Eunchae_Bob',lambda mat,f:mat in {'Hair','HairBase'}),
    part(dress,'Eunchae_Skirt',lambda mat,f:mat=='Dress' and f.calc_center_median().z<2.70),
    part(dress,'Eunchae_LowerLegs_Shoes',lambda mat,f:mat=='Shoes' or (mat=='Skin' and f.calc_center_median().z<1.05)),
]
# Extend the existing dress's lower section into a restrained midi skirt.
for v in parts[2].data.vertices:
    t=max(0,min(1,(2.65-v.co.z)/(2.65-1.826)))
    v.co.z-=.88*t
    v.co.x*=1-.06*t
    inset=1-.10*max(0,min(1,(v.co.z-2.25)/.4))
    v.co.x*=inset;v.co.y*=inset
skirt=parts[2]
skirt.vertex_groups.clear()
groups={name:skirt.vertex_groups.new(name=name)for name in ['Abdomen','OfficeSkirtUpper','OfficeSkirtLower']}
for v in skirt.data.vertices:
    upper_weight=max(0,min(1,(2.55-v.co.z)/.5))
    lower_weight=max(0,min(1,(1.6-v.co.z)/.5))*upper_weight
    for name,w in [('Abdomen',1-upper_weight),('OfficeSkirtUpper',upper_weight-lower_weight),('OfficeSkirtLower',lower_weight)]:
        if w>0:groups[name].add([v.index],w,'REPLACE')

palette={'Skin':'c59a78','Eyes':'292923','Eyebrows':'49392e','Hair':'503b2e','HairBase':'503b2e',
         'Shirt':'eee7d8','Jacket':'d2c4aa','LightJacket':'e0d4bd','Dress':'51685d','Shoes':'584438'}
def linear(hexcode):
    rgb=[int(hexcode[i:i+2],16)/255 for i in (0,2,4)]
    return [c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
materials={}
for name,color in palette.items():
    m=bpy.data.materials.new('Office_'+name);m.use_nodes=True
    m.node_tree.nodes.clear()
    bsdf=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    output=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(bsdf.outputs['BSDF'],output.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value=(*linear(color),1)
    bsdf.inputs['Roughness'].default_value=.8;bsdf.inputs['Metallic'].default_value=0
    m.diffuse_color=(*linear(color),1);materials[name]=m
for obj in parts:
    for i,mat in enumerate(obj.data.materials):
        if canon(mat.name) in materials:obj.data.materials[i]=materials[canon(mat.name)]

# Sample the supplied IK animation to a deform-only armature. Parent-relative
# matrices are derived from evaluated poses, preserving the original motion.
actions={}
sampled={}
for clip,end in [('idle',100),('walk',25),('sit',96)]:
    source.animation_data.action=source_actions[clip]
    frames=[]
    for frame in range(end+1):
        source_frame=frame if clip!='sit' else 20+30*(1-math.cos(2*math.pi*frame/end))
        bpy.context.scene.frame_set(int(source_frame),subframe=source_frame%1)
        bpy.context.view_layer.update()
        poses={p.name:p.matrix.copy() for p in source.pose.bones}
        # Anchor the seated pelvis to the chair rather than the source's feet.
        if clip=='sit':
            hip=poses['Hips'].translation
            shift=Matrix.Translation((-hip.x,-hip.y,0))
            poses={name:shift@mat for name,mat in poses.items()}
        for newname,oldname in [('OfficeSkirtUpper','UpperLeg'),('OfficeSkirtLower','LowerLeg')]:
            l=f'{oldname}.L';r=f'{oldname}.R'
            ql=poses[l].to_quaternion()@source.data.bones[l].matrix_local.to_quaternion().inverted()
            qr=poses[r].to_quaternion()@source.data.bones[r].matrix_local.to_quaternion().inverted()
            rotation=ql.slerp(qr,.5)@rig.data.bones[newname].matrix_local.to_quaternion()
            if newname=='OfficeSkirtUpper':head=(poses[l].translation+poses[r].translation)/2
            else:head=poses['OfficeSkirtUpper']@Vector((0,rig.data.bones['OfficeSkirtUpper'].length,0))
            poses[newname]=Matrix.Translation(head)@rotation.to_matrix().to_4x4()
        frames.append(poses)
    sampled[clip]=frames

rig.animation_data_create()
for clip,frames in sampled.items():
    action=bpy.data.actions.new('office_'+clip);action.use_fake_user=True
    rig.animation_data.action=action;actions[clip]=action
    previous={}
    for frame,poses in enumerate(frames):
        for bone in rig.pose.bones:
            rest=bone.bone.matrix_local
            basis=rest.inverted()@poses[bone.name]
            if bone.parent:
                basis=rest.inverted()@bone.parent.bone.matrix_local@poses[bone.parent.name].inverted()@poses[bone.name]
            loc,rot,scale=basis.decompose()
            if bone.name in previous and rot.dot(previous[bone.name])<0:rot.negate()
            previous[bone.name]=rot.copy()
            bone.rotation_mode='QUATERNION';bone.location=loc;bone.rotation_quaternion=rot;bone.scale=scale
            for prop in ['location','rotation_quaternion','scale']:bone.keyframe_insert(prop,frame=frame)
    action.use_frame_range=True;action.frame_start=0;action.frame_end=len(frames)-1
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for key in curve.keyframe_points:key.interpolation='LINEAR'

# Remove source scene and unused source actions only after sampling has finished.
for obj in list(bpy.context.scene.objects):
    if obj not in parts and obj!=rig:bpy.data.objects.remove(obj,do_unlink=True)
for action in list(bpy.data.actions):
    if action not in actions.values():bpy.data.actions.remove(action)
for clip,action in actions.items():action.name=clip
rig.animation_data.action=actions['idle'];bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()
verts=[obj.matrix_world@v.co for obj in parts for v in obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.vertices]
minz=min(v.z for v in verts);maxz=max(v.z for v in verts)
worldscale=1.9/(maxz-minz)
root=bpy.data.objects.new('Eunchae_Office',None);bpy.context.collection.objects.link(root)
root.scale=(worldscale,)*3;root.location.z=-minz*worldscale;rig.parent=root
bpy.context.scene.render.fps=24;bpy.context.scene.render.fps_base=1
bpy.context.scene.frame_start=0;bpy.context.scene.frame_end=100
bpy.ops.object.select_all(action='DESELECT')
for obj in [root,rig,*parts]:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(PUBLIC/'eunchae-office.glb'),export_format='GLB',use_selection=True,
    export_animation_mode='ACTIONS',export_anim_single_armature=True,export_force_sampling=True,
    export_frame_range=False,export_bake_animation=False,export_anim_slide_to_zero=True,
    export_morph_animation=False,export_cameras=False,export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'eunchae-office.blend'))

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=720;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.color=(.35,.35,.35);scene.view_settings.view_transform='AgX'
def point(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
for name,loc,power,size in [('Key',(-3,-4,5),450,4),('Fill',(3,-2,3),220,3),('Rim',(0,3,4),450,3)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;point(o,(0,0,1))
bpy.ops.mesh.primitive_plane_add(size=200)
mat=bpy.data.materials.new('Studio_Paper');mat.diffuse_color=(.72,.7,.66,1);bpy.context.object.data.materials.append(mat)
bpy.ops.object.camera_add(location=(2,-6,2.8));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=2.3
point(cam,(0,0,1));scene.camera=cam
stats={}
for clip in ['idle','walk','sit']:
    rig.animation_data.action=actions[clip];scene.frame_set(0 if clip!='walk' else 7)
    scene.render.filepath=str(OUT/(clip+'.png'));bpy.ops.render.render(write_still=True)
    vs=[o.matrix_world@v.co for o in parts for v in o.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.vertices]
    stats[clip]={'min':[min(v[i]for v in vs)for i in range(3)],'max':[max(v[i]for v in vs)for i in range(3)]}
(OUT/'bounds.json').write_text(json.dumps(stats,indent=2))
print('DELIVERED',PUBLIC/'eunchae-office.glb',flush=True)

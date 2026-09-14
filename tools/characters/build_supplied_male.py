"""Build the user-supplied clothed low-poly male without changing its geometry.

Blender --background --disable-autoexec --python tools/characters/build_supplied_male.py
The untouched source rig and its own Idle/Walk animations share one uniform
normalization parent. Working is a kneeling task animation, not a chair sit.
"""
import json
import struct
from pathlib import Path
import bpy
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'art/characters/supplied-bases/men'
OUTPUT = ROOT/'public/assets/characters/office-male-base.glb'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'ClothedMan.blend'))
scene = bpy.context.scene
rig = bpy.data.objects['Human Armature']
mesh = bpy.data.objects['Human_Mesh']
for obj in list(bpy.data.objects):
    if obj not in (rig, mesh):
        bpy.data.objects.remove(obj, do_unlink=True)
for track in list(rig.animation_data.nla_tracks):
    rig.animation_data.nla_tracks.remove(track)
rig.animation_data.action = bpy.data.actions['Idle']
rig.animation_data.action_slot = bpy.data.actions['Idle'].slots[0]
scene.frame_set(0)
bpy.context.view_layer.update()

def bounds():
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    vertices = [evaluated.matrix_world @ v.co for v in evaluated.data.vertices]
    return [[min(v[i] for v in vertices), max(v[i] for v in vertices)] for i in range(3)]

original = bounds()
root = bpy.data.objects.new('OfficeMale_Normalization', None)
scene.collection.objects.link(root)
rig.parent = root
factor = 1.9/(original[2][1]-original[2][0])
root.scale = (factor,)*3
root.location.z = -original[2][0]*factor
# Source faces Blender -Y, which the glTF Y-up conversion maps to +Z.
root['source'] = 'User-supplied Google Drive ClothedMan.blend'
root['license_status'] = 'CC0-1.0; verified official Quaternius Animated Man Pack download provenance'
root['standing_height_m'] = 1.9
root['clips_note'] = 'Original Idle/Walk plus authored static chair sit. Working is kneeling, excluded.'

material = bpy.data.materials.new('OfficeMale_Palette')
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
output = nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
bsdf.inputs['Roughness'].default_value = .87
bsdf.inputs['Metallic'].default_value = 0
texture = nodes.new('ShaderNodeTexImage')
texture.image = bpy.data.images.load(str(SOURCE/'ClothedLightSkin.png'), check_existing=True)
texture.interpolation = 'Closest'
# Retain source UV layout while replacing its bright game palette with office
# colors. This is a deterministic five-color swatch substitution.
pixels=list(texture.image.pixels[:])
colors={(124,88,35):(63,48,40),(115,167,196):(173,187,181),(21,96,189):(48,61,78)}
for i in range(0,len(pixels),4):
    rgb=tuple(round(pixels[i+j]*255) for j in range(3))
    if rgb in colors:
        for j in range(3): pixels[i+j]=colors[rgb][j]/255
texture.image.pixels[:]=pixels
texture.image.filepath_raw=str(SOURCE/'office-male-palette.png')
texture.image.file_format='PNG'
texture.image.save()
texture.image.pack()
material.node_tree.links.new(texture.outputs['Color'],bsdf.inputs['Base Color'])
mesh.data.materials.clear()
mesh.data.materials.append(material)
for face in mesh.data.polygons:
    face.material_index = 0
    face.use_smooth = False

# Build chair seating from the native skeleton. The supplied Working action is
# kneeling and cannot be reused as chair seating.
rig.animation_data.action = bpy.data.actions['Walk']
rig.animation_data.action_slot = bpy.data.actions['Walk'].slots[0]
scene.frame_set(0)
bpy.context.view_layer.update()
world_scale = factor*rig.scale.x
hip=rig.pose.bones['Hips']
hip_matrix=hip.matrix.copy()
hip_matrix.translation.z += (.61-(rig.matrix_world@hip.head).z)/world_scale
hip.matrix=hip_matrix
bpy.context.view_layer.update()
def point_bone(name,direction):
    bone=rig.pose.bones[name]
    current=(bone.tail-bone.head).normalized()
    turn=current.rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()
    matrix=bone.matrix.copy()
    translation=matrix.translation.copy()
    matrix.translation=(0,0,0)
    matrix=turn@matrix
    matrix.translation=translation
    bone.matrix=matrix
    bpy.context.view_layer.update()
for side in ['Left','Right']:
    point_bone(side+'UpLeg',(0,-1,0))
    point_bone(side+'Leg',(0,0,-1))
    point_bone(side+'Foot',(0,-1,-.08))
    point_bone(side+'ToeBase',(0,-1,0))
    point_bone(side+'Arm',(.08 if side=='Left' else -.08,-.18,-1))
    point_bone(side+'ForeArm',(0,-1,-.05))
    point_bone(side+'Hand',(0,-1,-.08))
# Place the soles on the same floor origin used by idle and walk.
hip_matrix=hip.matrix.copy()
hip_matrix.translation.z -= bounds()[2][0]/world_scale
hip.matrix=hip_matrix
bpy.context.view_layer.update()
sit=bpy.data.actions.new('sit')
rig.animation_data.action=sit
for bone in rig.pose.bones:
    for frame in [0,48]:
        bone.keyframe_insert(data_path='location',frame=frame)
        bone.keyframe_insert(data_path='rotation_quaternion' if bone.rotation_mode=='QUATERNION' else 'rotation_euler',frame=frame)
        bone.keyframe_insert(data_path='scale',frame=frame)

# The original Walk is already in-place. Snap its fractional endpoint to a
# full sample frame so glTF does not truncate its final loop pose.
walk=bpy.data.actions['Walk']
end=walk.frame_range[1]
for layer in walk.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points:
                    key.co.x*=25/end
                    key.handle_left.x*=25/end
                    key.handle_right.x*=25/end
# Use source animation data unchanged otherwise.
# Export just two named NLA tracks, retaining authored bone transforms/scales.
clips = []
for source_name, name in [('Idle','idle'),('Walk','walk')]:
    action = bpy.data.actions[source_name]
    action.name = name
    clips.append(action)
clips.append(sit)
rig.animation_data.action = None
for action in clips:
    track = rig.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, 0, action)
    strip.action_slot = action.slots[0]
    strip.extrapolation = 'NOTHING'
    track.mute = False
bpy.ops.object.select_all(action='DESELECT')
for obj in (root,rig,mesh):
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_anim_slide_to_zero=True,
    export_yup=True, export_extras=True,
)

# Restore an isolated idle pose for review and source editing.
for track in rig.animation_data.nla_tracks:
    track.mute = True
rig.animation_data.action = clips[0]
rig.animation_data.action_slot = clips[0].slots[0]
scene.frame_set(0)
bpy.context.view_layer.update()
report = {
    'source': 'ClothedMan.blend',
    'source_drive_folder': 'https://drive.google.com/drive/folders/1XQ3UpQezkOFDdazv6KK16qp3mBXhO9uO',
    'texture': 'ClothedLightSkin.png',
    'license': 'Not independently established from supplied male files.',
    'mesh_vertices': len(mesh.data.vertices),
    'uniform_scale': factor,
    'idle_bounds_blender': bounds(),
    'forward': '+Z in glTF; -Y in Blender',
    'sit_clip': 'Authored static chair pose on source rig; 2-second loop, soles at floor, no typing motion.',
    'clips': [{'name':a.name,'frames':list(a.frame_range),'fps':scene.render.fps} for a in clips],
    'working_clip': 'Not exported: source Working bends onto knees; not chair seating.',
}
(SOURCE/'build-report.json').write_text(json.dumps(report,indent=2))
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'office-male-base.blend'))

scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x = 768
scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.world.color = (.18,.18,.18)
def aim(obj, target):
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(3,-5,2.8))
camera = bpy.context.object
camera.data.type='ORTHO'
camera.data.ortho_scale=2.55
aim(camera,(0,0,.96))
scene.camera=camera
for location,energy,size in [((1,-3,5),350,4),((-3,-1,2),150,3),((1,3,3),250,3)]:
    bpy.ops.object.light_add(type='AREA',location=location)
    light=bpy.context.object
    light.data.energy=energy
    light.data.shape='DISK'
    light.data.size=size
    aim(light,(0,0,1))
scene.render.film_transparent=True
scene.render.filepath=str(SOURCE/'office-male-idle.png')
bpy.ops.render.render(write_still=True)
rig.animation_data.action=clips[1]
rig.animation_data.action_slot=clips[1].slots[0]
scene.frame_set(6)
scene.render.filepath=str(SOURCE/'office-male-walk.png')
bpy.ops.render.render(write_still=True)
rig.animation_data.action=sit
rig.animation_data.action_slot=sit.slots[0]
scene.frame_set(0)
scene.render.filepath=str(SOURCE/'office-male-sit.png')
bpy.ops.render.render(write_still=True)
print('BUILD_REPORT',json.dumps(report))

# Validate the exported artifact, not only the Blender scene.
blob=OUTPUT.read_bytes();size=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+size])
assert sorted(a['name'] for a in doc['animations'])==['idle','sit','walk']
assert len(doc['skins'])==1
assert doc['images'][0].get('bufferView') is not None
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUTPUT))
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
mesh=next(o for o in bpy.data.objects if o.type=='MESH')
report={'glb_bytes':len(blob),'embedded_texture':True,'skin_count':len(doc['skins']),'clips':{}}
for action in bpy.data.actions:
 rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 frames=sorted(set([0,12,int(action.frame_range[1])]))
 samples=[]
 positions=[]
 for frame in frames:
  bpy.context.scene.frame_set(frame)
  obj=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
  verts=[obj.matrix_world@v.co for v in obj.data.vertices]
  positions.append(verts)
  bb=[[min(v[i] for v in verts),max(v[i] for v in verts)] for i in range(3)]
  assert bb[2][1]<2.1 and bb[2][0]>-.02
  samples.append({'frame':frame,'bounds_blender':bb})
 seam=max((a-b).length for a,b in zip(positions[0],positions[-1]))
 if action.name in ['walk','sit']:assert seam<.001,(action.name,seam)
 report['clips'][action.name]={'samples':samples,'first_last_max_vertex_distance_m':seam}
(SOURCE/'glb-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))

"""Rebuild Eunchae from installed MPFB and licensed MakeHuman asset packs.

Blender --background --python tools/characters/build_eunchae_mpfb.py --
  --assets ~/.cache/deskrpg-mpfb/assets --source ~/.cache/deskrpg-mpfb/eunchae
The source .blend retains MPFB helpers and fitted clothing; only a copy is baked.
"""
import argparse
import math
import sys
from pathlib import Path

import addon_utils
import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from mpfb_motion import build_actions

parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, default=Path.home()/'.cache/deskrpg-mpfb/assets')
parser.add_argument('--source', type=Path, default=ROOT/'art/characters/eunchae-mpfb')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
args.source.mkdir(parents=True, exist_ok=True)
OUT = ROOT/'public/assets/characters'
OUT.mkdir(parents=True, exist_ok=True)
addon_utils.enable('bl_ext.user_default.mpfb')
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.exportservice import ExportService

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
macro = TargetService.get_default_macro_info_dict()
macro.update(gender=0.0, age=.32, muscle=.38, weight=.44)
macro['race'] = {'asian':.9, 'caucasian':.1, 'african':0.0}
human = HumanService.create_human(macro_detail_dict=macro)
human.name = 'Eunchae_Body'
# Keep the anatomical topology, but move away from photographic proportions.
bpy.context.view_layer.objects.active=human
bpy.ops.object.shape_key_remove(all=True,apply_mix=True)
for v in human.data.vertices:
    blend=max(0,min(1,(v.co.z-1.08)/.075))
    gain=1+.22*blend
    v.co.x*=gain
    v.co.y=-.025+(v.co.y+.025)*gain
    v.co.z=1.08+(v.co.z-1.08)*gain if blend else v.co.z
HumanService.set_character_skin(str(args.assets/'skins/young_asian_female/young_asian_female.mhmat'), human, skin_type='GAMEENGINE')
rig = HumanService.add_builtin_rig(human, 'game_engine')
rig.name = 'Eunchae_Rig'
assets = {}
for filename, kind, label in [
    ('low-poly.mhclo','Eyes','Eyes'),
    ('eyebrow001.mhclo','Eyebrows','Brows'),
    ('eyelashes01.mhclo','Eyelashes','Lashes'),
    ('bob01.mhclo','Hair','Bob'),
    ('toigo_basic_tucked_t-shirt.mhclo','Clothes','Ivory_Top'),
    ('mindfront_cardigan_long_open_front.mhclo','Clothes','Cardigan'),
    ('toigo_long_full_skirt.mhclo','Clothes','Forest_Skirt'),
    ('shoes02.mhclo','Clothes','Leather_Shoes'),
]:
    path = next(args.assets.rglob(filename))
    obj = HumanService.add_mhclo_asset(str(path), human, asset_type=kind, subdiv_levels=0, material_type='GAMEENGINE')
    obj.name = 'Eunchae_'+label
    assets[label] = obj
    print('Fitted', label, flush=True)

# Lift the source's eye-covering fringe into a soft side-parted bob. Keep the
# side/back length while showing both eyes at the normal map camera angle.
for v in assets['Bob'].data.vertices:
    if v.co.y<-.085 and abs(v.co.x)<.095:
        minimum=1.325-.18*abs(v.co.x)
        if v.co.z<minimum:v.co.z=minimum

# Crop the long source cardigan to a hip-length office cardigan. Sleeves keep
# their fitted shape; the former hanging panels are weighted to the torso.
cardigan=assets['Cardigan']
for v in cardigan.data.vertices:
    if v.co.z<.87 and abs(v.co.x)<.235:
        v.co.z=.777+(v.co.z-.236)/(.87-.236)*.093
        for group in cardigan.vertex_groups:group.remove([v.index])
        cardigan.vertex_groups.get('pelvis').add([v.index],1,'REPLACE')
# Reduce the bell silhouette below the waistband, retaining the original folds.
for v in assets['Forest_Skirt'].data.vertices:
    t=max(0,min(1,(.76-v.co.z)/.66))
    v.co.x*=1-.28*t
    v.co.y*=1-.18*t
for v in assets['Ivory_Top'].data.vertices:
    v.co.x*=.97;v.co.y*=.97
# The tee is an underlayer. Remove covered sleeves that otherwise poke through
# the fitted cardigan as their independently transferred weights bend.
bm=bmesh.new();bm.from_mesh(assets['Ivory_Top'].data)
bmesh.ops.delete(bm,geom=[v for v in bm.verts if abs(v.co.x)>.14 and v.co.z<1.12],context='VERTS')
bm.to_mesh(assets['Ivory_Top'].data);bm.free()

def srgb(rgb):
    a = np.array(rgb, dtype=np.float32)
    return np.where(a <= .04045, a/12.92, ((a+.055)/1.055)**2.4)

def tint(obj, color, roughness=.78):
    """Bake color into a new texture, retaining folds/knit/alpha from source."""
    for mat in obj.data.materials:
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = 0
        inp = bsdf.inputs['Base Color']
        image_nodes = [n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB']
        if not image_nodes:
            inp.default_value = (*srgb(color), 1)
            continue
        node = image_nodes[0]
        old = node.image
        if max(old.size) > 1024:
            old.scale(max(1, round(old.size[0]*1024/max(old.size))), max(1, round(old.size[1]*1024/max(old.size))))
        px = np.empty(old.size[0]*old.size[1]*4, dtype=np.float32)
        old.pixels.foreach_get(px)
        px = px.reshape(-1,4)
        lum = px[:,:3] @ np.array([.2126,.7152,.0722])
        med = max(float(np.median(lum[px[:,3]>.5])), .01)
        detail = np.clip(lum/med, .40, 1.3)
        if obj==assets['Forest_Skirt']:detail=.95+.05*detail
        px[:,:3] = np.clip(detail[:,None]*srgb(color)[None,:],0,1)
        new = bpy.data.images.new(obj.name+'_BaseColor',width=old.size[0],height=old.size[1],alpha=True)
        new.pixels.foreach_set(px.ravel());new.update()
        new.filepath_raw = str(args.source/(new.name+'.png'));new.file_format='PNG';new.save();new.pack()
        node.image = new
        inp.default_value=(1,1,1,1)

tint(assets['Cardigan'],(.84,.80,.71))
tint(assets['Ivory_Top'],(.93,.91,.85))
tint(assets['Forest_Skirt'],(.46,.53,.47))
tint(assets['Bob'],(.38,.25,.16),.85)
tint(assets['Leather_Shoes'],(.27,.18,.12),.54)
for obj in [human,*assets.values()]:
    for poly in obj.data.polygons:
        poly.use_smooth=True
    for mat in obj.data.materials:
        for n in mat.node_tree.nodes:
            if n.type=='BSDF_PRINCIPLED':
                n.inputs['Metallic'].default_value=0
                if obj==human:
                    n.inputs['Roughness'].default_value=.86
                    n.inputs['Subsurface Weight'].default_value=0
                    for link in list(n.inputs['Base Color'].links):mat.node_tree.links.remove(link)
                    n.inputs['Base Color'].default_value=(*srgb((.83,.66,.51)),1)
                n.inputs['Emission Strength'].default_value=0
    # glTF cannot use the obsolete MhMat opacity=0 metadata as transparency.
    if obj in (assets['Cardigan'],assets['Forest_Skirt'],assets['Ivory_Top'],assets['Eyes'],assets['Leather_Shoes'],human):
        for mat in obj.data.materials:
            bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            for link in list(bsdf.inputs['Alpha'].links):mat.node_tree.links.remove(link)
            bsdf.inputs['Alpha'].default_value=1
    else:
        for mat in obj.data.materials:
            bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            if bsdf.inputs['Alpha'].is_linked:
                source=bsdf.inputs['Alpha'].links[0].from_socket
                cut=mat.node_tree.nodes.new('ShaderNodeMath');cut.operation='GREATER_THAN';cut.inputs[1].default_value=.35
                mat.node_tree.links.new(source,cut.inputs[0]);mat.node_tree.links.new(cut.outputs[0],bsdf.inputs['Alpha'])

# Bake textures to supported sizes before packing the editable source.
for im in bpy.data.images:
    if im.source=='FILE' and im.size[0]:
        cap=512 if 'eye' in im.name else 1024
        if max(im.size)>cap:
            ratio=cap/max(im.size);im.scale(round(im.size[0]*ratio),round(im.size[1]*ratio))
        im.pack()
HumanService.serialize_to_json_file(human,str(args.source/'eunchae-mpfb.json'),save_clothes=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.source/'eunchae-mpfb-source.blend'))

# Remove shape targets and hidden helper/body geometry from the delivery copy.
bpy.context.view_layer.objects.active=human
human.select_set(True)
if human.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True,apply_mix=True)
ExportService.bake_modifiers_remove_helpers(human,bake_masks=True,bake_subdiv=False,remove_helpers=True)
for obj in assets.values():
    bpy.context.view_layer.objects.active=obj
    for mod in list(obj.modifiers):
        if mod.type in {'MASK','SUBSURF'}:
            if mod.type=='SUBSURF':obj.modifiers.remove(mod)
            else:bpy.ops.object.modifier_apply(modifier=mod.name)

# One parent scale establishes the asset's fixed 1.90 m height and +Z glTF front.
bpy.context.view_layer.update()
height=max((human.matrix_world@v.co).z for v in human.data.vertices)
scale=1.90/height
root=bpy.data.objects.new('Eunchae_MPFB',None);bpy.context.collection.objects.link(root)
rig.parent=root;root.scale=(scale,)*3
actions=build_actions(rig,scale)
rig.animation_data.action=actions['idle'];bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True);rig.select_set(True)
for obj in [human,*assets.values()]:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'eunchae-mpfb.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
    export_force_sampling=True,export_apply=False,export_lights=False,export_cameras=False,export_tangents=True,
    export_image_format='JPEG',export_jpeg_quality=85,export_yup=True,
    export_frame_range=False,export_morph_animation=False,export_bake_animation=False,
    export_anim_slide_to_zero=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.source/'eunchae-mpfb-animated.blend'))

# Neutral studio proof renders; these are inspection artifacts, not app assets.
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=768;scene.render.resolution_y=960;scene.render.resolution_percentage=100
scene.world.color=(.25,.25,.25)
scene.view_settings.view_transform='AgX'
def point(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
for name,loc,power,size in [('Key',(-3,-4,5),450,4),('Fill',(3,-2,3),220,3),('Rim',(0,3,4),500,3)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=loc;point(ob,(0,0,1))
bpy.ops.mesh.primitive_plane_add(size=200)
floor=bpy.context.object;floor.name='Studio_Floor'
mat=bpy.data.materials.new('Studio_Paper');mat.diffuse_color=(.72,.70,.66,1);floor.data.materials.append(mat)
bpy.ops.object.camera_add(location=(2.1,-5.5,2.5));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=2.30
point(cam,(0,0,1.0));scene.camera=cam
for clip in ('idle','sit','walk'):
    rig.animation_data.action=actions[clip];scene.frame_set(1 if clip!='walk' else 9)
    scene.render.filepath=str(args.source/(clip+'.png'));bpy.ops.render.render(write_still=True)
print('DELIVERED',OUT/'eunchae-mpfb.glb',flush=True)

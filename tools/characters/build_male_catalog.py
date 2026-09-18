"""Deterministic OfficeLook male wardrobe on the supplied ClothedMan rig.
History only: inputs live outside the repo. Current wardrobe source of truth is wardrobe_fit.py.
Run with Blender --background --disable-autoexec --python this_file.py.
No human generator, body replacement or OfficeLook ID mutation.
"""
import bpy, json, re, math, sys, subprocess
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from office_wardrobe import fabric,author_motion,hand_props,sweep_bounds,activate,correct_ground
OUT=ROOT/'public/assets/characters/office'; ART=ROOT/'art/characters/office-catalog/male'
OUT.mkdir(parents=True,exist_ok=True);ART.mkdir(parents=True,exist_ok=True)
subprocess.run(['npx','tsx','-e','import {OFFICE_LOOKS} from "./src/game/three/office-looks"; import {writeFileSync} from "node:fs"; writeFileSync("art/characters/office-catalog/male/looks.json",JSON.stringify(OFFICE_LOOKS.filter(x=>x.bodyType==="male"),null,2));'],cwd=str(ROOT),check=True)
looks=json.loads((ART/'looks.json').read_text())
if '--' in sys.argv:
 ids=sys.argv[sys.argv.index('--')+1:];looks=[look for look in looks if look['id'] in ids]
def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*[(int(color[i:i+2],16)/255/12.92 if int(color[i:i+2],16)/255<=.04045 else ((int(color[i:i+2],16)/255+.055)/1.055)**2.4) for i in (1,3,5)],1);m.use_nodes=True
 m.node_tree.nodes.clear();p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');out=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs['BSDF'],out.inputs['Surface']);p.inputs['Base Color'].default_value=m.diffuse_color;p.inputs['Roughness'].default_value=.86
 return m
reports=[]
for look in looks:
 print('BUILD',look['id'],flush=True)
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/characters/supplied-bases/men/office-male-base.blend'))
 scene=bpy.context.scene;rig=bpy.data.objects['Human Armature'];mesh=bpy.data.objects['Human_Mesh'];root=rig.parent
 rig.animation_data.action=None
 for t in rig.animation_data.nla_tracks:t.mute=True
 rig.data.pose_position='REST';bpy.context.view_layer.update()
 mats={k:mat(k,look[k])for k in ['skin','hair','coat','shirt','trousers','shoes']};mats['dark']=mat('dark','#292b29');mats['metal']=mat('metal','#c4b599');mats['seam']=mat('seam',look['coat']);next(n for n in mats['seam'].node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Base Color'].default_value=tuple(v*.70 if i<3 else v for i,v in enumerate(mats['seam'].diffuse_color))
 if look.get('tie'):mats['tie']=mat('tie',look['tie'])
 uv=mesh.data.uv_layers.active.data;img=bpy.data.images['ClothedLightSkin.png'];pixels=list(img.pixels[:]);cols=[]
 for p in mesh.data.polygons:
  u=uv[p.loop_indices[0]].uv;x=min(img.size[0]-1,int(u.x*img.size[0]));y=min(img.size[1]-1,int(u.y*img.size[1]));cols.append(tuple(round(v*255)for v in pixels[(y*img.size[0]+x)*4:][:3]))
 mesh.data.materials.clear()
 for m in mats.values():mesh.data.materials.append(m)
 keys=list(mats);hairverts=set(); shirtfaces=[]
 outfit=look['outfit']
 for p,col in zip(mesh.data.polygons,cols):
  c=mesh.matrix_world@p.center; vs=[mesh.matrix_world@mesh.data.vertices[i].co for i in p.vertices];z=sum(v.z for v in vs)/len(vs)
  key={(255,209,159):'skin',(63,48,40):'hair',(173,187,181):'shirt' if outfit=='shirt' else 'coat',(48,61,78):'shoes' if z<.12 else 'trousers',(41,41,41):'dark'}[col]
  if col==(255,209,159) and outfit!='shirt':
   arm=sum(g.weight for i in p.vertices for g in mesh.data.vertices[i].groups if mesh.vertex_groups[g.group].name in ['LeftArm','RightArm','LeftForeArm','RightForeArm'])/len(p.vertices)
   if arm>.7:key='shirt' if outfit=='vest' else 'coat'
  p.material_index=keys.index(key)
  if col==(63,48,40):hairverts.update(p.vertices)
  if col==(173,187,181):shirtfaces.append(p.index)
 # Different hair silhouettes, preserving the original hair mesh and rig weights.
 for i in hairverts:
  v=mesh.data.vertices[i];p=mesh.matrix_world@v.co
  if look['hairStyle']=='crop':p.z=1.77+(p.z-1.77)*.62
  elif look['hairStyle']=='part':p.z-=.025 if p.y<-.015 else 0;p.x+=.015 if p.y>.015 else 0
  elif look['hairStyle']=='wave':p.x+=.024*math.sin(p.y*24);p.z+=.016*math.cos(p.y*23)
  v.co=mesh.matrix_world.inverted()@p
 # Sculpt long coat hem directly from supplied skinned shirt mesh.
 if outfit in ['coat','labcoat']:
  indices={i for pi in shirtfaces for i in mesh.data.polygons[pi].vertices}
  for i in indices:
   v=mesh.data.vertices[i];p=mesh.matrix_world@v.co
   if p.z<1.13:p.z-=(.40 if outfit=='labcoat' else .30)*(1.13-p.z)/.23;p.y*=1.12;p.x*=1.10;v.co=mesh.matrix_world.inverted()@p
 # Ease complete coat/labcoat forearms radially from the supplied bone axes;
 # this adds a cloth silhouette and leaves the wrist/hand skin boundary intact.
 if outfit in ['coat','labcoat']:
  armnames=['LeftArm','RightArm','LeftForeArm','RightForeArm']
  for v in mesh.data.vertices:
   weights=[(g.weight,mesh.vertex_groups[g.group].name)for g in v.groups if mesh.vertex_groups[g.group].name in armnames]
   if not weights:continue
   weight,name=max(weights)
   if weight<.70:continue
   bone=rig.data.bones[name];a=rig.matrix_world@bone.head_local;b=rig.matrix_world@bone.tail_local;p=mesh.matrix_world@v.co;axis=(b-a).normalized();center=a+axis*(p-a).dot(axis)
   v.co=mesh.matrix_world.inverted()@(center+(p-center)*1.06)
 added=[]
 def bind(obj,name,material,bone='Spine2'):
  obj.name=name;obj.data.materials.append(mats[material]);world=obj.matrix_world.copy()
  for v in obj.data.vertices:v.co=rig.matrix_world.inverted()@world@v.co
  obj.matrix_world=rig.matrix_world.copy();obj.parent=rig;obj.matrix_parent_inverse=rig.matrix_world.inverted();obj.matrix_world=rig.matrix_world.copy()
  group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE');mod=obj.modifiers.new('Supplied rig','ARMATURE');mod.object=rig;added.append(obj)
 def box(name,pos,scale,material,bone='Spine2'):
  bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);bind(o,name,material,bone);return o
 def ball(name,pos,scale,material,bone='Head'):
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=pos);o=bpy.context.object;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);bind(o,name,material,bone)
 def panel(name,coords,material,bone='Spine2'):
  data=bpy.data.meshes.new(name);data.from_pydata(coords,[],[tuple(range(len(coords)))]);data.update();o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);bind(o,name,material,bone)
 # Front in rest space is +X. Panels sit just outside original chest.
 if outfit in ['suit','double-breasted','coat','labcoat','vest']:
  panel('Shirt inset',[(.135,-.105,1.56),(.135,.105,1.56),(.151,.0,1.22)],'shirt')
  for sign in [-1,1]:
   panel('Tailored lapel',[(.145,sign*.12,1.57),(.163,sign*.17,1.43),(.171,sign*.05,1.22),(.15,sign*.035,1.46)],'coat')
   if outfit in ['suit','double-breasted','coat','labcoat']:box('Jacket pocket',(.15,sign*.115,1.10),(.014,.085,.025),'coat','Spine')
 if outfit!='hoodie':
  for sign in [-1,1]:panel('Collar',[(.112,sign*.085,1.59),(.157,sign*.02,1.52),(.162,sign*.075,1.47)],'shirt')
 if look.get('tie'):
  panel('Tie',[(.169,-.017,1.52),(.169,.017,1.52),(.18,.027,1.28),(.18,0,1.24),(.18,-.027,1.28)],'tie')
 if look.get('neckwear')=='turtleneck' or look['id']=='office-jin':box('Turtleneck',(.006,0,1.605),(.17,.16,.07),'shirt','Neck')
 if outfit=='hoodie':
  ball('Hood down',(-.10,0,1.54),(.13,.16,.095),'coat','Spine2')
  box('Hoodie zipper',(.145,0,1.33),(.018,.009,.40),'metal')
  for s in [-1,1]:box('Drawstring',(.157,s*.045,1.47),(.012,.009,.13),'shirt');box('Kangaroo pocket',(.156,s*.065,1.12),(.015,.10,.09),'coat','Spine')
 if outfit=='vest':
  panel('Vest V neck',[(.155,-.075,1.51),(.155,.075,1.51),(.17,0,1.32)],'shirt')
 for z in [1.15,1.26,1.37]:
  for y in ([-.06,.06] if outfit=='double-breasted' else [0]):
   if outfit not in ['hoodie']:ball('Button',(.172,y,z),(.009,.009,.009),'metal','Spine1')
 if look['hairStyle']=='curls':
  for j in range(10):
   a=j*math.tau/10;ball('Hair curl',(.008+math.cos(a)*.095,math.sin(a)*.115,1.925+(.018 if j%2 else 0)),(.065,.057,.064),'hair')
 if look.get('glasses'):
  for s in [-1,1]:
   for z in [1.82,1.87]:box('Glasses rim',(.171,s*.062,z),(.015,.09,.009),'dark','Head')
   for y in [s*.018,s*.106]:box('Glasses rim',(.17,y,1.845),(.015,.009,.055),'dark','Head')
   box('Glasses temple',(.10,s*.119,1.856),(.14,.009,.009),'dark','Head')
  box('Glasses bridge',(.176,0,1.853),(.015,.027,.009),'dark','Head')
 if look.get('accessory')=='headset':
  for s in [-1,1]:ball('Headset cup',(.015,s*.14,1.83),(.055,.028,.065),'dark');box('Headset band',(-.018,s*.13,1.855),(.04,.018,.10),'dark','Head')
  box('Headset crown',(-.018,0,1.92),(.04,.26,.025),'dark','Head')
  box('Microphone boom',(.16,-.14,1.77),(.16,.014,.014),'dark','Head')
 if look.get('accessory')=='badge' or look['id']=='office-jun':
  box('ID lanyard',(.169,.065,1.38),(.008,.009,.20),'dark');box('ID badge',(.18,.065,1.25),(.014,.06,.08),'shirt');box('ID photo',(.19,.055,1.26),(.009,.02,.025),'coat')
 bag=look.get('bag')
 if bag=='backpack':
  # Fit the back panel to the supplied torso; the previous offset floated.
  box('Backpack',(-.17,0,1.32),(.18,.29,.35),'shoes')
  for s in [-1,1]:box('Backpack strap',(.13,s*.12,1.40),(.025,.025,.32),'shoes')
 elif bag=='shoulder':
  box('Shoulder satchel',(-.025,.26,1.02),(.16,.11,.22),'shoes','Hips');box('Shoulder strap',(.12,.15,1.32),(.025,.025,.5),'shoes')
 # Hand props are built from the final normalized palm pose below.
 # Replace source crouching Idle with an upright office stance on its native rig.
 rig.data.pose_position='POSE';rig.animation_data.action=None
 for b in rig.pose.bones:b.matrix_basis.identity()
 bpy.context.view_layer.update()
 from mathutils import Matrix
 hip=rig.pose.bones['Hips'];hip.matrix=Matrix.Rotation(-math.pi/2,4,'Z')@hip.matrix
 bpy.context.view_layer.update()
 def point(name,direction):
  b=rig.pose.bones[name];turn=(b.tail-b.head).normalized().rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4();m=b.matrix.copy();p=m.translation.copy();m.translation=(0,0,0);m=turn@m;m.translation=p;b.matrix=m;bpy.context.view_layer.update()
 for side,sign in [('Left',1),('Right',-1)]:
  point(side+'Arm',(sign*.12,0,-1));point(side+'ForeArm',(sign*.02,-.07,-1));point(side+'Hand',(0,-.03,-1))
 def bodybounds():
  dg=bpy.context.evaluated_depsgraph_get();vs=[ob.evaluated_get(dg).matrix_world@v.co for ob in [mesh]+added for v in ob.evaluated_get(dg).data.vertices];return min(v.z for v in vs),max(v.z for v in vs)
 lo,hi=bodybounds();scale=1.9/(hi-lo);root.scale*=scale;root.location*=scale;bpy.context.view_layer.update();lo,hi=bodybounds();root.location.z-=lo;bpy.context.view_layer.update()
 old=bpy.data.actions.get('idle')
 for t in list(rig.animation_data.nla_tracks):
  if t.name=='idle':rig.animation_data.nla_tracks.remove(t)
 if old:bpy.data.actions.remove(old)
 idle=bpy.data.actions.new('idle');rig.animation_data.action=idle
 for b in rig.pose.bones:
  for frame in [0,48]:
   b.keyframe_insert(data_path='location',frame=frame);b.keyframe_insert(data_path='rotation_quaternion' if b.rotation_mode=='QUATERNION' else 'rotation_euler',frame=frame);b.keyframe_insert(data_path='scale',frame=frame)
 rig.animation_data.action=None;t=rig.animation_data.nla_tracks.new();t.name='idle';strip=t.strips.new('idle',0,idle);strip.action_slot=idle.slots[0];strip.extrapolation='NOTHING'
 # Align clip feet with translation only; normalization scale belongs solely to root.
 for clipname in ['walk','sit']:
  action=bpy.data.actions[clipname];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
  frames=range(int(action.frame_range[0]),int(action.frame_range[1])+1);locations=[]
  for frame in frames:
   scene.frame_set(frame);bpy.context.view_layer.update();lo,hi=bodybounds();m=hip.matrix.copy();m.translation.z-=(lo-(.003 if clipname=='walk' else 0))/rig.matrix_world.to_scale().z;hip.matrix=m;locations.append((frame,hip.location.copy()))
  for frame,location in locations:
   hip.location=location;hip.keyframe_insert(data_path='location',frame=frame)
 actions={name:bpy.data.actions[name]for name in ['idle','walk','sit']}
 motion_report=author_motion(rig,actions,look,'male')
 ground_report=correct_ground(rig,actions['walk'],[mesh],{mats['shoes']},'Hips',clearance=.003)
 print('GROUND',look['id'],ground_report,flush=True)
 activate(rig,actions['idle']);scene.frame_set(0);bpy.context.view_layer.update()
 prop_report=hand_props(rig,actions,look,'male',mats['shoes'] if look.get('bag')=='briefcase' else mats['coat'],mats['shirt'],added)
 pattern_mats=[mats['shirt']] if outfit=='shirt' else [mats['coat']]
 if outfit in ['suit','double-breasted']:pattern_mats.append(mats['trousers'])
 fabric_files=fabric(look,[mesh]+added,pattern_mats,ART)
 bounds_sweep=sweep_bounds(rig,actions,[mesh]+added,{mats['shoes']})
 rig.animation_data.action=None
 for t in rig.animation_data.nla_tracks:t.mute=False
 bpy.ops.object.select_all(action='DESELECT')
 for o in [root,rig,mesh]+added:o.select_set(True)
 bpy.context.view_layer.objects.active=rig
 root['officeLookId']=look['id'];root['wardrobe']=outfit;root['license']='CC0-1.0';root['license_status']='Verified from official Quaternius source page';root['clips_note']='Individual restrained idle/sit motion, supplied walk, palm-bound props; common root normalization and translation-only floor correction'
 bpy.ops.export_scene.gltf(filepath=str(OUT/(look['id']+'.glb')),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_anim_slide_to_zero=True,export_yup=True,export_extras=True)
 for t in rig.animation_data.nla_tracks:t.mute=True
 action=bpy.data.actions['idle'];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];scene.frame_set(0)
 bpy.context.preferences.filepaths.save_version=0
 # One editable representative per garment type; all looks are reproducible from script.
 if outfit not in [r['outfit']for r in reports]:bpy.ops.wm.save_as_mainfile(filepath=str(ART/(outfit+'.blend')))
 scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=320;scene.render.resolution_y=400;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.world.color=(.35,.35,.35)
 def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(location=(3,-6,2.6));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=2.4;aim(cam,(0,0,.96));scene.camera=cam
 for pos,energy in [((2,-4,5),400),((-3,-1,3),250),((1,3,4),300)]:
  bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=energy;l.data.size=4;aim(l,(0,0,1))
 scene.render.film_transparent=True
 for clip in ['idle','walk','sit']:
  activate(rig,actions[clip]);scene.frame_set(7 if clip=='walk' else 0);bpy.context.view_layer.update()
  scene.render.filepath=str(ART/(look['id']+('-'+clip if clip!='idle' else '')+'.png'));bpy.ops.render.render(write_still=True)
 reports.append({'id':look['id'],'outfit':outfit,'hairStyle':look['hairStyle'],'added_meshes':len(added),'bytes':(OUT/(look['id']+'.glb')).stat().st_size,'motion':motion_report,'walkGroundContact':ground_report,'handProp':prop_report,'fabricFiles':fabric_files,'quarterFrameBounds':bounds_sweep})
 (ART/(look['id']+'.json')).write_text(json.dumps(reports[-1],indent=2))
 (ART/'build-report.json').write_text(json.dumps({'source':'supplied-bases/men/office-male-base.blend','looks':[json.loads(p.read_text())for p in sorted(ART.glob('office-*.json'))],'limitations':['Shared supplied body proportions; native-rig upright idle authored at 1.9 m.','Idle/sit add restrained per-look upper-body motion; not task-specific typing.','Garments are stylized surface tailoring; no cloth simulation.','Build hint does not distort supplied base proportions; stance drives individual motion.']},indent=2))
print('MALE CATALOG COMPLETE',len(reports))

"""Re-import all final GLBs; audit quarter-frame sole contact and render review angles.
Blender --background --disable-autoexec --python-exit-code 1 --python tools/characters/audit_office_wardrobe.py
"""
import bpy,json,math,sys,hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'art/characters/office-catalog/wardrobe-audit';OUT.mkdir(parents=True,exist_ok=True)
looks=[]
for sex in ['female','male']:looks.extend(json.loads((ROOT/f'art/characters/office-catalog/{sex}/looks.json').read_text()))
if '--'in sys.argv:
 ids=sys.argv[sys.argv.index('--')+1:];looks=[l for l in looks if l['id'] in ids]
results=[]
review_ids={'office-haena','office-yeon','office-eun','office-hyo','office-jin','office-hosu','office-min','office-gonu','office-sera','office-seona','office-garam','office-yul','office-jiho','office-ian','office-woojin','office-dohun','office-chan'}
for look in looks:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/characters/office'/(look['id']+'.glb')))
 scene=bpy.context.scene;rig=next(o for o in bpy.data.objects if o.type=='ARMATURE');meshes=[o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE'for m in o.modifiers)]
 for track in rig.animation_data.nla_tracks:track.mute=True
 actions={a.name:a for a in bpy.data.actions};assert set(actions)=={'idle','walk','sit'},(look['id'],list(actions))
 shoes={o:{i for p in o.data.polygons if o.data.materials[p.material_index].name.lower().split('.')[0].endswith('shoes') for i in p.vertices}for o in meshes};shoes={o:v for o,v in shoes.items()if v};assert shoes,look['id']
 row={'id':look['id'],'sha256':hashlib.sha256((ROOT/'public/assets/characters/office'/(look['id']+'.glb')).read_bytes()).hexdigest(),'clips':{},'propParent':None}
 prop=rig.data.bones.get('OfficeHandProp')
 if look.get('bag')=='briefcase'or look.get('accessory')=='notebook':
  assert prop and prop.parent and ('Hand'in prop.parent.name or 'Palm'in prop.parent.name),(look['id'],'prop not parented to palm')
  row['propParent']=prop.parent.name
 for name,action in actions.items():
  rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];start,end=action.frame_range;count=int(round((end-start)*4))+1;minsole=1e9;samples=[]
  for i in range(count):
   frame=start+i/4;scene.frame_set(int(frame),subframe=frame%1);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
   for ob,indices in shoes.items():
    ev=ob.evaluated_get(dg);minsole=min(minsole,min((ev.matrix_world@ev.data.vertices[v].co).z for v in indices))
   if i in [0,count//2,count-1]:
    vs=[ob.evaluated_get(dg).matrix_world@v.co for ob in meshes for v in ob.evaluated_get(dg).data.vertices]
    samples.append({'frame':frame,'bounds':[[min(v[j]for v in vs),max(v[j]for v in vs)]for j in range(3)]})
  assert minsole>=-.002,(look['id'],name,'floor',minsole)
  row['clips'][name]={'quarterFrameSamples':count,'soleMin':minsole,'bounds':samples}
 if look['id'] in review_ids:
  if scene.world is None:scene.world=bpy.data.worlds.new('Wardrobe review world')
  scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.render.resolution_x=400;scene.render.resolution_y=480;scene.render.resolution_percentage=100;scene.world.color=(.35,.35,.35);scene.view_settings.view_transform='AgX'
  def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
  for loc,power in [((-3,-4,5),450),((3,-1,3),250),((1,4,4),400)]:
   bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.size=4;aim(o,(0,0,1))
  bpy.ops.mesh.primitive_plane_add(size=200);plane=bpy.context.object;material=bpy.data.materials.new('Review paper');material.diffuse_color=(.63,.60,.54,1);plane.data.materials.append(material)
  bpy.ops.object.camera_add();camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=2.35;scene.camera=camera
  for clip,frame in [('idle',0),('walk',7),('sit',0)]:
   action=actions[clip];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];scene.frame_set(frame)
   for angle,loc in [('front',(2,-6,2.5)),('side',(6,0,2.3)),('rear',(-2,6,2.5))]:
    camera.location=loc;aim(camera,(0,0,.97));scene.render.filepath=str(OUT/(look['id']+'-'+clip+'-'+angle+'.png'));bpy.ops.render.render(write_still=True)
 results.append(row);(OUT/(look['id']+'.json')).write_text(json.dumps(row,indent=2))
 print('AUDIT PASS',look['id'],{k:v['soleMin']for k,v in row['clips'].items()},flush=True)
(OUT/'report.json').write_text(json.dumps([json.loads(p.read_text())for p in sorted(OUT.glob('office-*.json'))],indent=2))
print('IMPORTED WARDROBE AUDIT COMPLETE',len(results))

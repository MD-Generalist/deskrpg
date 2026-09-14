"""Sample evaluated seated calf/foot geometry against the sofa front planes.

Run with Blender: blender --background --python tools/characters/audit_sofa_clearance.py
This checks sampled front clearance, not continuous collision or all clothing.
The complete report is written before failing on missing samples or penetration.
"""
import bpy,json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2]
results=[]
for path in sorted((root/'public/assets/characters/office').glob('*.glb')):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(path))
 rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
 for t in rig.animation_data.nla_tracks:t.mute=True
 a=bpy.data.actions['sit'];rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0]
 meshes=[]
 for ob in bpy.context.scene.objects:
  if ob.type!='MESH':continue
  ids=[]
  for v in ob.data.vertices:
   if any(g.weight>.5 and (ob.vertex_groups[g.group].name.lower().startswith('lowerleg') or ob.vertex_groups[g.group].name in ['LeftLeg','RightLeg','LeftFoot','RightFoot','Foot.L','Foot.R']) for g in v.groups):ids.append(v.index)
  if ids:meshes.append((ob,ids))
 count=0;worst=100;needed=0
 for f in range(0,int(a.frame_range[1])+1,3):
  bpy.context.scene.frame_set(f);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
  for ob,ids in meshes:
   ev=ob.evaluated_get(dg);mesh=ev.to_mesh()
   for i in ids:
    w=ev.matrix_world@mesh.vertices[i].co;z=w.z+.055
    front=.41 if .165<z<.395 else (.375 if .395<=z<.545 else None)
    if front is not None:
     clearance=-w.y+.30-front;worst=min(worst,clearance);needed=max(needed,front+w.y+.015);count+=1
   ev.to_mesh_clear()
 result={'id':path.stem,'samples':count,'minClearance':worst if count else None,'requiredForward':needed,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
 results.append(result);print('SOFA_AUDIT',json.dumps(result),flush=True)
(root/'art/characters/office-catalog/sofa-clearance-audit.json').write_text(json.dumps(results,indent=2))

if len(results) != 50 or any(
    row["samples"] == 0 or row["minClearance"] < 0 for row in results
):
    raise RuntimeError("Sofa clearance audit failed; inspect sofa-clearance-audit.json")

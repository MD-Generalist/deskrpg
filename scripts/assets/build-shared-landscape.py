"""Original DeskRPG shared landscape assets; Blender 5.1.1, no external inputs.
Run from repository root: blender -b --factory-startup --python-exit-code 1 --python scripts/assets/build-shared-landscape.py
"""
import bpy, math, random, json, os
from mathutils import Vector
OUT='public/assets/shared/landscape'
os.makedirs(OUT,exist_ok=True)
random.seed(2909)

def material(name,color,rough=.7,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True
 bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
 return m
BARK=material('Warm fissured bark',(.19,.135,.078),.96)
SOIL=material('Dark potting soil',(.055,.035,.016),1)
POT=material('Warm cast stone planter',(.43,.37,.29),.82)
LEAVES=[material('Leaf tone '+str(i),c,.67) for i,c in enumerate([(.075,.15,.035),(.13,.22,.058),(.19,.29,.095),(.095,.18,.08)])]
for m in LEAVES:m.use_backface_culling=False
STONE=material('Facade limestone',(.44,.46,.44),.72)
FRAME=material('Anodised bronze mullions',(.10,.13,.145),.4,.6)
GLASS=[material('Glazing reflectance '+str(i),c,.24,.35) for i,c in enumerate([(.22,.32,.39),(.31,.41,.46),(.43,.49,.50),(.17,.23,.28)])]
ROOF=material('Roof equipment',(.22,.25,.25),.7)

def point(p):return Vector((p[0],-p[2],p[1]))
def finish(o,mat):
 o.data.materials.append(mat)
 for f in o.data.polygons:f.use_smooth=True
 return o

def box(name,size,loc,mat,bevel=.008):
 bpy.ops.mesh.primitive_cube_add(size=1,location=point(loc));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  b=o.modifiers.new('Edge finish','BEVEL');b.width=bevel;b.segments=2;bpy.ops.object.modifier_apply(modifier=b.name)
  b=o.modifiers.new('Face normals','WEIGHTED_NORMAL');b.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=b.name)
 finish(o,mat)
 if not bevel:
  for polygon in o.data.polygons:polygon.use_smooth=False
 return o

def branch(a,b,r,mat=BARK):
 va,vb=point(a),point(b);d=vb-va
 bpy.ops.mesh.primitive_cone_add(vertices=7,radius1=r,radius2=r*.55,depth=d.length,location=(va+vb)/2)
 o=bpy.context.object;o.name='Tapered branch';o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return finish(o,mat)

def lathe(name,profile,mat,segments=48):
 verts=[];faces=[]
 for radius,y in profile:
  for i in range(segments):
   a=math.tau*i/segments;verts.append(point((math.cos(a)*radius,y,math.sin(a)*radius)))
 for j in range(len(profile)-1):
  for i in range(segments):
   a=j*segments+i;b=j*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);return finish(o,mat)

# Each leaf is a curved, pointed mesh, with a midrib ridge and a real silhouette.
# No green spheres, alpha cards, or transparent sorting are used.
def leaf(center,length,width,angle,tilt,tone):
 verts=[]
 for i in range(7):
  t=i/6;spread=math.sin(math.pi*t)**.85*width
  for side in [-1,0,1]:
   xx=side*spread;zz=(t-.5)*length
   yy=.05*math.sin(t*math.pi)*length + (.014 if side==0 else 0)-t*t*length*.16
   z=zz*math.cos(tilt)-yy*math.sin(tilt);y=zz*math.sin(tilt)+yy*math.cos(tilt)
   verts.append(point((center[0]+xx*math.cos(angle)+z*math.sin(angle),center[1]+y,center[2]-xx*math.sin(angle)+z*math.cos(angle))))
 faces=[]
 for i in range(6):
  for j in range(2):faces.append((i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j))
 # Opaque double-sided blades avoid duplicate coplanar faces.
 mesh=bpy.data.meshes.new('Leaf blade');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('Curved individual leaf',mesh);bpy.context.collection.objects.link(o);finish(o,LEAVES[tone%len(LEAVES)])
 for polygon in mesh.polygons:polygon.use_smooth=False

def planter():
 lathe('Hollow tapered planter',[(0,.018),(.205,.018),(.24,.045),(.275,.38),(.28,.43),(.254,.447),(.242,.416),(.231,.36)],POT)
 lathe('Recessed soil',[(0,.37),(.237,.37)],SOIL)
 for i in range(28):
  a=random.random()*math.tau;r=random.random()*.21
  box('Soil granule',(.012,.01,.015),(math.cos(a)*r,.377,math.sin(a)*r),SOIL,.003)

def plant(olive=False):
 planter()
 base=(0,.37,0);tip=(.025,1.43,0)
 branch(base,tip,.025)
 for i in range(15):
  a=i*2.399;h=.64+i*.047;radius=.19+random.random()*.09
  start=(.02,h-.13,0);end=(math.cos(a)*radius,h+.09,math.sin(a)*radius)
  branch(start,end,.009)
  for k in range(6 if olive else 4):
   t=.45+k*.1;c=tuple(start[j]+(end[j]-start[j])*t for j in range(3))
   c=(c[0]+math.sin(k*2.4)*.045,c[1],c[2]+math.cos(k*2.4)*.045)
   leaf(c,.16 if olive else .24,.022 if olive else .055,a+k*2.4,.2+random.random()*.5,i+k)

def street_tree():
 branch((0,0,0),(.08,2.2,.02),.095)
 for i in range(18):
  a=i*2.399;h=1.3+(i%6)*.23;r=.52+random.random()*.4
  start=(.04,1.05+(i%5)*.16,0);tip=(math.cos(a)*r,h+.55,math.sin(a)*r)
  branch(start,tip,.033)
  for j in range(7):
   aa=a+j*.87;end=(tip[0]+math.cos(aa)*.24,tip[1]+random.uniform(-.2,.3),tip[2]+math.sin(aa)*.24)
   branch(tip,end,.009)
   for k in range(7):
    c=(end[0]+random.uniform(-.19,.19),end[1]+random.uniform(-.13,.18),end[2]+random.uniform(-.19,.19))
    leaf(c,.27,.075,random.random()*math.tau,random.uniform(-.4,.8),i+j+k)

def tower(stone=False):
 height=5.8 if stone else 7.2;w=1.4;d=1.15
 box('Tower core',(w,height,d),(0,height/2,0),STONE if stone else FRAME)
 floors=19 if stone else 24
 for f in range(floors):
  y=.24+f*.285
  for side in [-1,1]:
   for col in range(5):
    x=-.56+col*.28
    panel=GLASS[(col+f*3+(f//4))%4]
    box('Recessed window',(.235,.22,.018),(x,y,side*(d/2+.012)),panel,0)
    if stone and f%3==0:box('Stone transom',(w+.045,.035,.055),(0,y-.133,side*(d/2+.015)),STONE,.003)
   for col in range(4):
    z=-.42+col*.28
    box('Return facade window',(.018,.22,.235),(side*(w/2+.012),y,z),GLASS[(col+f)%4],0)
 for x in [-.7,0,.7]:box('Continuous facade mullion',(.035,height,.04),(x,height/2,d/2+.034),FRAME,.002)
 box('Roof parapet',(w+.05,.10,d+.05),(0,height+.045,0),STONE)
 for x in [-.38,.28]:
  box('Rooftop HVAC',(.33,.19,.32),(x,height+.18,0),ROOF)
  for z in [-.1,-.05,0,.05,.1]:box('HVAC grille',(.31,.012,.009),(x,height+.281,z),FRAME,.001)
 branch((.45,height,.3),(.45,height+.5,.3),.011,FRAME)

report={}
for name,build in [('ficus',plant),('olive',lambda:plant(True)),('street-tree',street_tree),('glass-tower',tower),('stone-tower',lambda:tower(True))]:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);random.seed(2909);build()
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.convert(target='MESH');objs=list(bpy.context.selected_objects)
 bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();o=bpy.context.object
 bounds=[o.matrix_world@Vector(v) for v in o.bound_box]
 report[name]={'triangles':sum(len(p.vertices)-2 for p in o.data.polygons),'bounds_blender':[[min(v[i] for v in bounds) for i in range(3)],[max(v[i] for v in bounds) for i in range(3)]]}
 bpy.ops.export_scene.gltf(filepath=OUT+'/'+name+'-v1.glb',export_format='GLB',use_selection=True,export_apply=True,export_yup=True)
 report[name]['bytes']=os.path.getsize(OUT+'/'+name+'-v1.glb')
with open(OUT+'/build-report.json','w') as f:json.dump(report,f,indent=2)
print(json.dumps(report))

"""Original DeskRPG studio kits. Blender 5.1, seed 140928, meters/Y-up/+Z front.
Run from any output root; only public/assets/environments/creative-studio is written.
Furniture dressing uses ground-center origin with its final surface height baked in.
"""
import bpy, math, json, os, tempfile, struct
import numpy as np
from mathutils import Vector
OUT=os.path.abspath('public/assets/environments/creative-studio');os.makedirs(OUT,exist_ok=True)
TEMP=tempfile.TemporaryDirectory(prefix='deskrpg-studio-kits-')
S=512;v,u=np.mgrid[0:S,0:S].astype(float)/S;rng=np.random.default_rng(140928)
fiber=(rng.random((S,S))-.5)*.05+.012*np.sin(u*math.tau*153)

def image(name,data,color=False):
    im=bpy.data.images.new(name,width=S,height=S,alpha=True);im.colorspace_settings.name='sRGB' if color else 'Non-Color'
    rgba=np.ones((S,S,4),dtype=np.float32);rgba[:,:,:3]=np.clip(data,0,1);im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw=os.path.join(TEMP.name,name+'.png');im.file_format='PNG';im.save();return im

def mat(name,color,rough=.7,metal=0,pbr=False,emission=0,atlas=False):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;bs=next(n for n in n if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
    if emission:bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emission
    if pbr:
        field=(fiber*.10 if name=='coral-sweep' else fiber) if name!='oak' else fiber+.04*np.sin(v*math.tau*43+np.sin(u*math.tau*2))
        rgb=np.stack([c+field for c in color],-1)
        if atlas:
            palette=[(.22,.43,.42),(.80,.41,.29),(.80,.62,.26),(.36,.43,.51)]
            for row in range(4):
                for col in range(4):
                    x=(u*4-col);y=(v*4-row);inside=(x>.10)&(x<.90)&(y>.10)&(y<.90)
                    mode=(row*3+col)%4
                    if mode==0:
                        block=inside&(x<.46)&(y>.34);circle=inside&((x-.65)**2+(y-.64)**2<.19**2)
                        rgb[block|circle]=palette[(row+col)%4]
                    elif mode==1:
                        for k in range(4):
                            cx=.30+(k%2)*.39;cy=.44+(k//2)*.30
                            rgb[inside&(abs(x-cx)<.15)&(abs(y-cy)<.12)]=palette[(k+row)%4]
                    elif mode==2:
                        disk=inside&((x-.5)**2+(y-.57)**2<.30**2)
                        rgb[disk]=palette[(row+col)%4];rgb[disk&(x>.48)]=palette[(row+col+2)%4]
                    else:
                        for k in range(5):rgb[inside&(x>.17+k*.035)&(x<.82)&(y>.34+k*.1)&(y<.40+k*.1)]=palette[(k+col)%4]
                    stripes=inside&(y<.27)&(np.mod(y,.045)<.015);rgb[stripes]=(.26,.30,.29)
        dx=np.roll(field,-1,1)-np.roll(field,1,1);dy=np.roll(field,-1,0)-np.roll(field,1,0)
        normal=np.stack([-dx,-dy,np.ones_like(dx)],-1);normal/=np.linalg.norm(normal,axis=-1)[:,:,None]
        for key,data in [('color',rgb),('normal',normal*.5+.5),('roughness',np.repeat(np.clip(rough+field,.1,1)[:,:,None],3,axis=2))]:
            node=n.new('ShaderNodeTexImage');node.image=image(name+'-'+key,data,key=='color')
            if key=='normal':nm=n.new('ShaderNodeNormalMap');l.new(node.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs['Normal'],bs.inputs['Normal'])
            else:l.new(node.outputs['Color'],bs.inputs['Base Color' if key=='color' else 'Roughness'])
    return m

CORAL=mat('coral-sweep',(.77,.37,.28),.9,pbr=True)
BLACK=mat('painted-metal',(.035,.044,.046),.38,.65,pbr=True)
SILVER=mat('brushed-metal',(.40,.43,.43),.3,.8)
OAK=mat('oak',(.77,.66,.50),.57,pbr=True)
PAPER=mat('paper',(.88,.84,.74),.93,pbr=True)
PRINT=mat('printed-paper',(.94,.91,.84),.9,pbr=True,atlas=True)
WHITE=mat('reflector-cloth',(.89,.90,.86),.92,pbr=True)
DIFFUSER=WHITE.copy();DIFFUSER.name='diffuser'
next(n for n in DIFFUSER.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Emission Color'].default_value=(.89,.90,.86,1)
next(n for n in DIFFUSER.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Emission Strength'].default_value=.35
TEAL=mat('cutting-mat',(.12,.32,.30),.91,pbr=True)
LENS=mat('lens',(.025,.070,.063),.13,.5)
CERAMIC=mat('ceramic',(.83,.81,.73),.25)
COFFEE=mat('coffee',(.045,.025,.014),.22)
FRUIT=mat('fruit',(.86,.55,.07),.47)
INK=[mat('accent-'+str(i),c,.8) for i,c in enumerate([(.23,.49,.46),(.82,.43,.32),(.84,.65,.29),(.35,.42,.47)])]

def box(name,w,h,d,x,y,z,m,bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,y));o=bpy.context.object;o.name=name;o.dimensions=(w,d,h)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    uv=o.data.uv_layers.active.data
    for face in o.data.polygons:
        for idx in face.loop_indices:
            p=o.matrix_world@o.data.vertices[o.data.loops[idx].vertex_index].co
            if abs(face.normal.z)>.5:a,b=p.x,-p.y
            elif abs(face.normal.y)>.5:a,b=p.x,p.z
            else:a,b=-p.y,p.z
            uv[idx].uv=(a,b)
    if bevel:
        mod=o.modifiers.new('Rounded edge','BEVEL');mod.width=min(bevel,min(w,h,d)*.4);mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in o.data.polygons:p.use_smooth=True
        mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(m);return o

def rod(name,r,h,x,y,z,m,vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=h,location=(x,-z,y));o=bpy.context.object;o.name=name
    mod=o.modifiers.new('Soft rim','BEVEL');mod.width=min(.004,h*.18);mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in o.data.polygons:p.use_smooth=True
    mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(m);return o

def beam(name,a,b,r,m):
    a=Vector((a[0],-a[2],a[1]));b=Vector((b[0],-b[2],b[1]));mid=(a+b)/2
    o=rod(name,r,(b-a).length,mid.x,mid.z,-mid.y,m,12);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def sphere(name,r,x,y,z,m):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=r,location=(x,-z,y));o=bpy.context.object;o.name=name;o.data.materials.append(m)
    for p in o.data.polygons:p.use_smooth=True
    return o

def ring(name,r,x,y,z,m,minor=.009):
    bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=minor,major_segments=16,minor_segments=6,location=(x,-z,y));o=bpy.context.object;o.name=name;o.data.materials.append(m);return o

def tripod(height=1.3,radius=.40):
    beam('Telescopic stand',(0,.18,0),(0,height,0),.020,BLACK)
    rod('Lock collar',.034,.07,0,height*.6,0,BLACK)
    for i in range(3):
        a=i*math.tau/3;beam('Spread tripod leg',(0,.5,0),(math.sin(a)*radius,.025,math.cos(a)*radius),.014,BLACK)

def cyclorama():
    # One continuous surface: floor, quarter-circle sweep and vertical wall.
    profile=[(1.42,.045),(-.60,.045)]
    for i in range(1,25):
        a=i*math.pi/48;profile.append((-.60-.78*math.sin(a),.045+.78*(1-math.cos(a))))
    profile.append((-1.38,2.75));verts=[]
    for z,y in profile:verts.extend([(-3.2,-z,y),(3.2,-z,y)])
    faces=[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(profile)-1)]
    mesh=bpy.data.meshes.new('Continuous swept backdrop');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('Coral cyclorama continuous sweep',mesh);bpy.context.collection.objects.link(o);mesh.materials.append(CORAL)
    uv=mesh.uv_layers.new();
    for face in mesh.polygons:
        face.use_smooth=True
        for idx in face.loop_indices:
            p=mesh.vertices[mesh.loops[idx].vertex_index].co;uv.data[idx].uv=(p.x/3,p.z/3-p.y/3)
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    mod=o.modifiers.new('Paper thickness','SOLIDIFY');mod.thickness=.008;bpy.ops.object.modifier_apply(modifier=mod.name)
    for x in [-3.30,3.30]:beam('Backdrop support',(x,.01,-1.35),(x,2.90,-1.35),.028,BLACK)
    beam('Backdrop roll',(-3.36,2.82,-1.34),(3.36,2.82,-1.34),.045,CORAL)
    # Decorative posing stool remains inside the already solid backdrop footprint.
    rod('Photo posing stool',.24,.07,.10,.57,.40,OAK,32)
    for a in [0,math.tau/3,math.tau*2/3]:beam('Posing stool leg',(.10+math.sin(a)*.16,.54,.40+math.cos(a)*.16),(.10+math.sin(a)*.20,.015,.40+math.cos(a)*.20),.018,OAK)

def softbox():
    tripod(1.55,.37)
    box('Softbox black housing',.80,.85,.25,0,1.65,-.03,BLACK,.035)
    box('Emissive linen diffuser',.72,.77,.018,0,1.65,.107,DIFFUSER,.018)
    for x in [-.30,.30]:beam('Housing rib',(0,1.65,-.17),(x,1.30,.05),.008,SILVER)

def camera():
    tripod(1.24,.39)
    box('Tripod head',.18,.09,.18,0,1.26,0,BLACK)
    box('Camera body',.35,.23,.19,0,1.41,0,BLACK,.027)
    box('Camera grip',.09,.25,.21,.19,1.40,.015,BLACK,.025)
    box('Viewfinder',.13,.06,.09,0,1.55,-.025,BLACK)
    beam('Lens barrel',(0,1.42,.06),(0,1.42,.31),.10,BLACK)
    beam('Lens glass',(0,1.42,.307),(0,1.42,.32),.085,LENS)
    box('Rear camera display',.22,.13,.005,-.025,1.42,-.099,LENS,.003)
    rod('Shutter button',.020,.016,.13,1.54,.02,SILVER)

def reflector():
    tripod(1.02,.32)
    disk=rod('Reflector fabric',.40,.022,0,1.19,0,WHITE,48);disk.rotation_euler.x=math.pi/2
    hoop=ring('Reflector hoop',.405,0,1.19,0,BLACK,.012);hoop.rotation_euler.x=math.pi/2

def equipment_shelf():
    for x in [-.91,.91]:
        for z in [-.36,.36]:beam('Equipment rack upright',(x,.0,z),(x,2.08,z),.022,BLACK)
    for y in [.16,.76,1.36,1.98]:box('Open equipment rack shelf',1.90,.05,.82,0,y,0,OAK)
    for i in range(5):
        x=-.72+i*.34;y=.41 if i%2 else 1.01
        box('Padded equipment case',.29,.37,.48,x,y,.04,BLACK,.026)
        box('Case label',.13,.05,.008,x,y+.07,.285,PAPER,.003)
        box('Case handle',.12,.035,.045,x,y+.20,.025,BLACK)
    for i in range(3):rod('Spare lens',.085,.20,-.60+i*.29,1.48,.04,BLACK,20)
    for i in range(3):box('Reflector sleeve',.08,.46,.45,.40+i*.14,1.61,-.03,INK[i],.008)
    box('Canvas accessory box',.54,.24,.43,-.47,2.125,0,PAPER,.02)

def card(w,d,x,y,z,index=0,angle=0):
    paper=box('Printed stock edge',w,.010,d,x,y,z,PAPER,.002);paper.rotation_euler.z=-angle
    verts=[(-w/2,d/2,0),(w/2,d/2,0),(w/2,-d/2,0),(-w/2,-d/2,0)]
    mesh=bpy.data.meshes.new('Original graphic print');mesh.from_pydata(verts,[],[(3,2,1,0)]);mesh.update();o=bpy.data.objects.new('Abstract original editorial print',mesh);bpy.context.collection.objects.link(o);o.location=(x,-z,y+.006);o.rotation_euler.z=-angle;mesh.materials.append(PRINT)
    uv=mesh.uv_layers.new();col=index%4;row=(index//4)%4
    coords=[(.01,.01),(.99,.01),(.99,.99),(.01,.99)]
    for i,loop in enumerate(mesh.loops):a,b=coords[loop.vertex_index];uv.data[i].uv=((col+a)/4,(row+b)/4)

def cup(x,y,z):
    rod('Ceramic cup',.072,.13,x,y+.065,z,CERAMIC,24)
    rod('Coffee visible surface',.060,.006,x,y+.132,z,COFFEE,24)
    handle=ring('Cup handle',.034,x+.081,y+.075,z,CERAMIC,.009);handle.rotation_euler.x=math.pi/2

def tablet(x,y,z,angle=0):
    body=box('Tablet anodized body',.32,.018,.43,x,y,z,BLACK,.014);body.rotation_euler.z=-angle
    display=box('Tablet screen',.28,.003,.37,x,y+.011,z,LENS,.009);display.rotation_euler.z=-angle

def production():
    box('Large cutting mat',1.22,.012,.86,-.25,.868,.05,TEAL,.01)
    for x in np.arange(-.79,.31,.11):box('Cutting mat grid line',.002,.001,.78,float(x),.875,.05,PAPER,0)
    for z in np.arange(-.31,.44,.11):box('Cutting mat grid line',1.12,.001,.002,-.25,.875,float(z),PAPER,0)
    for i,(x,z) in enumerate([(-2.20,-.75),(-1.50,-.68),(-.75,-.77),(.12,-.77),(.94,-.75),(1.75,-.70),(-2.13,.65),(-1.35,.66),(.5,.66),(1.35,.64),(2.20,.67)]):
        angle=(i%5-2)*.095;card(.44,.55,x,.868,z,i,angle)
        if i%3==0:card(.40,.50,x+.035,.883,z+.022,i+3,angle+.03)
    for i in range(7):
        sw=box('Color swatch fan',.17,.006,.32,.61+i*.075,.881+i*.004,-.02,INK[i%4],.002);sw.rotation_euler.z=-.12+i*.11
    tablet(-1.55,.88,.02,-.06);tablet(1.95,.88,-.12,.09)
    cup(-2.45,.87,.02);cup(2.40,.87,-.81)
    for i in range(5):beam('Graphite and colored pencil',(-.9+i*.06,.888,.53),(-.86+i*.06,.888,.85),.007,INK[i%4])
    box('Metal ruler',.035,.005,.66,.44,.883,.08,SILVER,.001)
    for i in range(4):card(.42,.54,1.76-i*.013,.875+i*.017,.63,i+8,-.13+i*.016)
    box('Sample presentation box',.37,.12,.30,1.29,.928,-.02,PAPER)
    rod('Pen cup',.06,.14,-2.40,.94,-.77,CERAMIC,20)
    for i in range(3):beam('Standing pen',(-2.43+i*.025,.89,-.77),(-2.44+i*.032,1.16,-.76),.006,INK[i])

def ideation():
    for i in range(8):
        a=i*math.tau/8;card(.28,.36,math.sin(a)*.88,.868,math.cos(a)*.88,i,a+.12)
    for i in range(5):box('Loose color sample',.12,.006,.16,-.24+i*.11,.878+(i%2)*.006,.06,INK[i%4],.002)
    tablet(.04,.878,-.47,.13);cup(-.42,.87,.42);cup(.47,.87,.45)
    for i in range(3):beam('Ideation marker',(-.42+i*.04,.887,-.1),(-.38+i*.04,.887,-.31),.007,INK[i])

def notes():
    for i in range(16):
        x=-.68+(i%4)*.43;y=.88+(i//4)*.25;z=.061+(i%3)*.001
        o=box('Pinned idea card',.28,.18,.007,x,y,z,PAPER if i%3 else INK[i%4],.002);o.rotation_euler.y=(i%5-2)*.025
        rod_pin=sphere('Brass pin',.009,x,y+.070,z+.01,SILVER)
        for j in range(2):box('Generic note mark',.14-j*.035,.006,.002,x-.03,y+.023-j*.025,z+.005,INK[(i+1)%4],0)

def samples():
    for i in range(6):
        x=-.72+i*.27;box('Upright material sample',.19,.32,.10,x,1.23,.12,INK[i%4],.006)
        box('Sample label',.11,.035,.004,x,1.13,.173,PAPER,.001)
    for i in range(3):rod('Rolled print sample',.052,.39,-.63+i*.14,1.27,-.15,PAPER,20)
    box('Sample tray',.60,.045,.28,.44,1.085,-.15,OAK)

def pantry():
    # Base counter and coral wall stay in shared furniture/architecture.
    box('Espresso machine body',.53,.49,.40,1.12,1.20,-.015,BLACK,.022)
    box('Brushed machine front',.46,.30,.025,1.12,1.20,.205,SILVER)
    box('Drip tray',.47,.026,.22,1.12,.976,.28,BLACK)
    for x in [.99,1.24]:beam('Coffee dispenser',(x,1.27,.23),(x,1.19,.23),.018,BLACK)
    cup(1.03,.985,.29);cup(1.26,.985,.29)
    for i in range(2):rod('Espresso control',.023,.014,1.01+i*.20,1.375,.224,BLACK)
    rod('Grinder base',.105,.28,.54,1.10,-.05,BLACK,24)
    rod('Coffee bean hopper',.092,.18,.54,1.33,-.05,COFFEE,24)
    box('Pantry tray',.62,.025,.37,-1.30,.969,.02,OAK)
    for i in range(3):
        x=-1.48+i*.19;rod('Ceramic bottle',.065,.23,x,1.095,-.04,INK[i],20);rod('Bottle neck',.024,.08,x,1.25,-.04,INK[i],16)
    rod('Fruit bowl',.23,.065,-.36,.995,.08,CERAMIC,32)
    for i in range(5):a=i*math.tau/5;sphere('Citrus fruit',.06,-.36+math.sin(a)*.12,1.07,.08+math.cos(a)*.12,FRUIT)
    cup(-.87,.96,.18);card(.23,.28,.10,.966,.06,4,.08)

def art_wall():
    box('Gallery mounting board',3.14,1.85,.026,-.32,2.12,-.04,OAK,.008)
    for i in range(5):
        x=-1.42+(i%3)*1.1;y=1.75+(i//3)*.91;w=.80;h=.67
        box('Oak gallery frame',w+.08,h+.08,.055,x,y,0,OAK,.012)
        box('Gallery mount',w,h,.012,x,y,.035,PAPER,.002)
        # Original abstract geometric artwork, no brands or borrowed art.
        box('Art colored block',w*.33,h*.61,.004,x-.17,y+.035,.044,INK[i%4],.002)
        circle=rod('Art circle',.17,.004,x+.15,y-.08,.047,INK[(i+2)%4],32);circle.rotation_euler.x=math.pi/2
        for j in range(3):box('Art geometric rule',.24,.008,.004,x+.14,y+.18+j*.027,.046,INK[(i+1)%4],0)

def workstation():
    box('Display bezel',.61,.36,.045,0,1.22,-.25,BLACK,.016)
    box('Display glass',.56,.31,.004,0,1.22,-.223,LENS,.003)
    beam('Monitor stand',(0,.87,-.26),(0,1.14,-.26),.023,SILVER)
    box('Monitor foot',.21,.018,.15,0,.874,-.21,BLACK)
    box('Keyboard',.39,.018,.13,-.03,.878,.07,BLACK,.005)
    for j in range(3):
        for i in range(9):box('Keyboard key',.030,.005,.026,-.18+i*.038,.890,.024+j*.041,PAPER,.001)
    box('Trackpad',.10,.011,.13,.31,.875,.08,SILVER,.008)
    cup(-.35,.866,.22);card(.16,.19,.25,.868,.31,7,.05)

def conference():
    for i in range(6):
        x=-1.25+(i%3)*1.25;z=-.48 if i<3 else .48;card(.29,.36,x,.868,z,i,.05*(i-2));cup(x+.27,.865,z)
    tablet(0,.88,0);rod('Water carafe',.072,.25,-.48,.99,0,CERAMIC,24)

def coffee_table():
    card(.28,.34,-.24,.495,.05,2,-.14);card(.26,.32,-.21,.508,.08,6,.06);cup(.23,.49,.09)

builds=[('photo-cyclorama','photo',cyclorama,30000),('photo-softbox','photo',softbox,3000),('photo-camera-tripod','photo',camera,3000),('photo-reflector','photo',reflector,3000),('photo-equipment-shelf','photo',equipment_shelf,30000),('production-table-dressed','production',production,30000),('round-ideation-dressed','ideation',ideation,30000),('mobile-idea-board','ideation',notes,30000),('sample-display','production',samples,12000),('pantry-counter-dressed','pantry',pantry,30000),('art-wall-dressed','ideation',art_wall,12000),('workstation-dressed','production',workstation,12000),('conference-table-dressed','ideation',conference,12000),('coffee-table-dressed','ideation',coffee_table,3000)]
report={}
for name,folder,build,budget in builds:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);build()
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    objs=list(bpy.context.selected_objects);bpy.context.view_layer.objects.active=objs[0]
    if len(objs)>1:bpy.ops.object.join()
    o=bpy.context.object;bpy.context.view_layer.update()
    if o.data.validate(verbose=True):raise RuntimeError('Invalid mesh repaired '+name)
    pts=[o.matrix_world@Vector(p) for p in o.bound_box];pts=[(p.x,p.z,-p.y) for p in pts]
    bounds={'units':'meters','min':[min(p[i] for p in pts) for i in range(3)],'max':[max(p[i] for p in pts) for i in range(3)]}
    dest=os.path.join(OUT,folder);os.makedirs(dest,exist_ok=True);path=os.path.join(dest,name+'-v1.glb')
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_image_format='WEBP',export_image_quality=88)
    blob=open(path,'rb').read();n=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+n]);triangles=sum(doc['accessors'][p['indices']]['count']//3 for mesh in doc['meshes'] for p in mesh['primitives'])
    if triangles>budget or len(blob)>2000000:raise RuntimeError('Budget exceeded '+name+': '+str(triangles))
    report[name]={'triangles':triangles,'bytes':len(blob),'bounds':bounds,'seed':140928,'source':'scripts/assets/build-creative-studio-kits.py','license':'repository-original','invalidMesh':False,'materialSlots':[m['name'] for m in doc['materials']]}
with open(os.path.join(OUT,'build-report.json'),'w') as f:json.dump(report,f,indent=2);f.write('\n')
print('CREATIVE_STUDIO_KIT_REPORT '+json.dumps(report))

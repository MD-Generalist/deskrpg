"""DeskRPG original shared furniture. Blender 5.1; seed 140927; meters/Y-up/+Z front.
Run from repository root. No external models or textures. Interactive furniture is undressed.
"""
import bpy,math,json,os,tempfile,struct
import numpy as np
from mathutils import Vector
OUT=os.path.abspath('public/assets/shared/furniture');os.makedirs(OUT,exist_ok=True)
tmp=tempfile.TemporaryDirectory(prefix='deskrpg-studio-furniture-')
S=512;v,u=np.mgrid[0:S,0:S].astype(float)/S;rng=np.random.default_rng(140927)
noise=rng.random((S,S))-.5

def image(name,data,color=False):
    im=bpy.data.images.new(name,width=S,height=S,alpha=True);im.colorspace_settings.name='sRGB' if color else 'Non-Color'
    a=np.ones((S,S,4),dtype=np.float32);a[:,:,:3]=np.clip(data,0,1);im.pixels.foreach_set(a.ravel())
    im.filepath_raw=os.path.join(tmp.name,name+'.png');im.file_format='PNG';im.save();return im

def material(name,color,rough=.65,metal=0,field=None):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;bs=next(n for n in n if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
    if field is not None:
        dx=(np.roll(field,-1,1)-np.roll(field,1,1))*2;dy=(np.roll(field,-1,0)-np.roll(field,1,0))*2
        normal=np.stack([-dx,-dy,np.ones_like(dx)],-1);normal/=np.linalg.norm(normal,axis=-1)[:,:,None]
        rgb=np.stack([c+field*.12 for c in color],-1)
        for key,data in [('color',rgb),('normal',normal*.5+.5),('roughness',np.repeat(np.clip(rough+field*.12,.15,1)[:,:,None],3,axis=2))]:
            t=n.new('ShaderNodeTexImage');t.image=image(name+'-'+key,data,key=='color')
            if key=='normal':
                nm=n.new('ShaderNodeNormalMap');l.new(t.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs['Normal'],bs.inputs['Normal'])
            else:l.new(t.outputs['Color'],bs.inputs['Base Color' if key=='color' else 'Roughness'])
    return m

grain=.06*np.sin(v*math.tau*51+np.sin(u*math.tau*2))+.025*np.sin(v*math.tau*139)+noise*.025
weave=.03*np.sin(u*math.tau*171)*np.cos(v*math.tau*171)+noise*.04
OAK=material('oak',(.79,.71,.58),.49,field=grain)
UP=material('upholstery',(.94,.94,.94),.88,field=weave)
SIDE=UP.copy();SIDE.name='Cream linen' # Explicit catalog slot preserves the existing shared-side-chair contract.
STEEL=material('painted-metal',(.065,.085,.082),.36,.6)
PAINT=material('cabinet-paint',(.70,.74,.70),.64)
PAPER=material('paper',(.90,.87,.79),.84)
RUBBER=material('rubber',(.025,.028,.029),.8)
COLORS=[material('book-'+str(i),c,.85) for i,c in enumerate([(.34,.52,.50),(.72,.39,.29),(.75,.61,.33),(.83,.78,.66)])]

def box(name,w,h,d,x,y,z,mat,bevel=.012):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,y));o=bpy.context.object;o.name=name;o.dimensions=(w,d,h)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if mat in [OAK,UP,SIDE]:
        uv=o.data.uv_layers.active.data
        for face in o.data.polygons:
            for idx in face.loop_indices:
                p=o.matrix_world @ o.data.vertices[o.data.loops[idx].vertex_index].co
                if abs(face.normal.z)>.5:a,b=p.x,-p.y
                elif abs(face.normal.y)>.5:a,b=p.x,p.z
                else:a,b=-p.y,p.z
                uv[idx].uv=(a/(2 if mat==OAK else .5),b/(1 if mat==OAK else .5))
    mod=o.modifiers.new('Rounded authored edge','BEVEL');mod.width=min(bevel,min(w,h,d)*.45);mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in o.data.polygons:p.use_smooth=True
    mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat);return o

def rod(name,r,h,x,y,z,mat,vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=h,location=(x,-z,y));o=bpy.context.object;o.name=name
    mod=o.modifiers.new('Soft rim','BEVEL');mod.width=min(.007,h*.2);mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in o.data.polygons:p.use_smooth=True
    mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat);return o

def ring(name,r,y,mat,minor=.012):
    bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=minor,major_segments=32,minor_segments=6,location=(0,0,y));o=bpy.context.object;o.name=name;o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True

def feet(w,d,height=.15):
    for x in [-w/2+.08,w/2-.08]:
        for z in [-d/2+.08,d/2-.08]:box('Timber foot',.055,height,.055,x,height/2,z,OAK,.008)

def table(w,d):
    box('Pale oak continuous top',w,.10,d,0,.81,0,OAK,.045)
    box('Fine underside reveal',w-.12,.024,d-.12,0,.75,0,OAK)
    for x in [-w/2+.22,w/2-.22]:
        for z in [-d/2+.18,d/2-.18]:box('Powder coated table leg',.07,.73,.07,x,.365,z,STEEL,.009)
    for z in [-d/2+.18,d/2-.18]:box('Apron',w-.36,.09,.04,0,.70,z,OAK)

def workstation():
    table(.97,.97)
    box('Underdesk cable basket',.5,.045,.13,0,.69,-.30,STEEL)
    box('Cable grommet inset',.055,.005,.028,.34,.862,-.32,STEEL,.01)

def side_chair():
    feet(.57,.55,.405)
    box('Contoured padded seat',.62,.11,.58,0,.405,0,SIDE,.047)
    back=box('Curved padded back',.60,.49,.085,0,.72,-.245,SIDE,.035);back.rotation_euler.x=-.08
    for x in [-.255,.255]:box('Oak back support',.035,.39,.035,x,.60,-.235,OAK)

def office_chair():
    rod('Swivel hub',.075,.35,0,.22,0,STEEL)
    for i in range(5):
        a=i*math.tau/5
        spoke=box('Five-star base spoke',.31,.034,.038,math.sin(a)*.14,.10,math.cos(a)*.14,STEEL);spoke.rotation_euler.z=-a
        wheel=rod('Caster',.043,.036,math.sin(a)*.29,.047,math.cos(a)*.29,RUBBER,16);wheel.rotation_euler.x=math.pi/2
    box('Upholstered office seat',.63,.12,.62,0,.40,0,UP,.05)
    back=box('Ergonomic back shell',.62,.58,.12,0,.79,-.25,UP,.05);back.rotation_euler.x=-.07
    for x in [-.32,.32]:
        box('Arm support',.025,.21,.03,x,.54,0,STEEL)
        box('Soft arm pad',.055,.045,.39,x,.66,0,UP,.018)

def round_table():
    rod('Round oak review top',1.42,.10,0,.81,0,OAK,64)
    rod('Tapered central pedestal',.30,.75,0,.375,0,OAK,32)
    rod('Inset foot',.54,.055,0,.0275,0,STEEL,48)

def sofa(curved=False):
    for i,x in enumerate([-.94,0,.94]):
        before=set(bpy.context.scene.objects)
        box('Upholstered modular plinth',.97,.24,.77,x,.25,0,UP,.07)
        box('Separate seat cushion',.87,.16,.68,x,.45,.04,UP,.055)
        box('Rounded back cushion',.90,.51,.15,x,.705,-.295,UP,.06)
        for xx in [x-.34,x+.34]:
            for zz in [-.25,.25]:box('Recessed sofa foot',.045,.13,.045,xx,.065,zz,STEEL)
        if curved:
            a=[-.22,0,.22][i];dz=[.01,-.10,.01][i]
            for o in set(bpy.context.scene.objects)-before:
                px,pz=o.location.x-x,-o.location.y
                o.location.x=x+px*math.cos(a)+pz*math.sin(a);o.location.y=-(dz-px*math.sin(a)+pz*math.cos(a));o.rotation_euler.z-=a
    # Short end bolsters preserve the open curved silhouette and fit a 3×1 tile footprint.
    for x in [-1.405,1.405]:box('Soft end bolster',.09,.36,.62,x,.43,.035,UP,.04)

def armchair():
    feet(.82,.74,.13)
    box('Upholstered armchair base',.86,.24,.80,0,.25,0,UP,.065)
    box('Seat cushion',.65,.16,.66,0,.45,.035,UP,.05)
    box('Back cushion',.68,.51,.16,0,.705,-.30,UP,.06)
    for x in [-.385,.385]:box('Rolled arm',.095,.46,.76,x,.44,0,UP,.04)

def stool():
    for x in [-.20,.20]:
        for z in [-.20,.20]:box('Bar stool leg',.038,.655,.038,x,.3275,z,OAK,.008)
    rod('Rounded oak stool seat',.30,.08,0,.68,0,OAK,48)
    ring('Footrest',.23,.245,STEEL)

def storage(shelf=False):
    feet(1.85,.7,.12)
    box('Oak cabinet back',1.92,.87,.035,0,.555,-.365,OAK)
    for x in [-.935,.935]:box('Oak side',.05,.94,.78,x,.55,0,OAK)
    for y in [.13,1.03]:box('Oak horizontal',1.92,.055,.78,0,y,0,OAK)
    if shelf:
        box('Middle shelf',1.86,.045,.75,0,.56,0,OAK)
        for x in [-.32,.32]:box('Cubby divider',.035,.84,.73,x,.57,0,OAK)
        for i in range(18):
            x=-.82+(i%9)*.20;y=.31 if i<9 else .77
            b=box('Bound reference volume',.08,.28+(i%3)*.028,.25,x,y,.15,COLORS[i%4],.004)
            if i%5==0:b.rotation_euler.y=.08
    else:
        for x in [-.465,.465]:
            box('Inset cabinet door',.90,.82,.035,x,.585,.39,PAINT)
            box('Steel cabinet pull',.025,.11,.045,x+(.32 if x<0 else -.32),.64,.425,STEEL,.005)

def board():
    for x in [-.79,.79]:
        box('Mobile board upright',.045,1.80,.055,x,.97,0,STEEL)
        box('Outrigger foot',.10,.055,.80,x,.065,0,STEEL)
        for z in [-.32,.32]:
            wheel=rod('Board caster',.045,.035,x,.045,z,RUBBER,16);wheel.rotation_euler.x=math.pi/2
    box('Oak board frame',1.88,1.23,.075,0,1.27,0,OAK,.025)
    box('Blank pinboard face',1.78,1.13,.018,0,1.27,.045,PAPER,.01)
    box('Marker tray',.75,.035,.09,0,.66,.085,STEEL)

def counter():
    box('Recessed pantry plinth',3.75,.12,.72,0,.06,0,STEEL)
    box('Cabinet carcass',3.92,.77,.85,0,.485,0,PAINT)
    box('Oak counter top',3.98,.08,.96,0,.91,0,OAK,.022)
    for x in [-1.45,-.48,.48,1.45]:
        box('Inset counter door',.93,.70,.025,x,.5,.44,PAINT)
        box('Counter pull',.18,.018,.035,x,.77,.465,STEEL,.005)

def coffee():
    rod('Oak coffee top',.87,.075,0,.45,0,OAK,64)
    for i in range(3):
        a=i*math.tau/3;box('Coffee table leg',.07,.415,.07,math.sin(a)*.48,.2075,math.cos(a)*.48,OAK)

def rug(round_=False):
    if round_:rod('Round woven rug',1.88,.022,0,.011,0,UP,64)
    else:box('Bound woven rug',5.9,.022,3.9,0,.011,0,UP,.009)

report={}
for name,build in [('workstation',workstation),('office-chair',office_chair),('side-chair',side_chair),('round-table',round_table),('production-table',lambda:table(5.9,2.85)),('curved-sofa',lambda:sofa(True)),('sofa',sofa),('armchair',armchair),('stool',stool),('credenza',storage),('low-shelf',lambda:storage(True)),('mobile-board',board),('round-rug',lambda:rug(True)),('woven-rug',rug),('counter',counter),('conference-table',lambda:table(3.9,1.85)),('coffee-table',coffee)]:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);build()
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    objs=list(bpy.context.selected_objects);bpy.context.view_layer.objects.active=objs[0]
    if len(objs)>1:bpy.ops.object.join()
    o=bpy.context.object;bpy.context.view_layer.update()
    if o.data.validate(verbose=True):raise RuntimeError('Invalid mesh repaired: '+name)
    pts=[o.matrix_world@Vector(p) for p in o.bound_box];pts=[(p.x,p.z,-p.y) for p in pts]
    bounds={'units':'meters','min':[min(p[i] for p in pts) for i in range(3)],'max':[max(p[i] for p in pts) for i in range(3)]}
    path=os.path.join(OUT,name+'-v1.glb');bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_image_format='WEBP',export_image_quality=86)
    blob=open(path,'rb').read();n=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+n]);triangles=sum(doc['accessors'][p['indices']]['count']//3 for mesh in doc['meshes'] for p in mesh['primitives'])
    if triangles>12000 or len(blob)>2000000:raise RuntimeError('Budget exceeded '+name)
    report[name]={'triangles':triangles,'bytes':len(blob),'bounds':bounds,'seed':140927,'source':'scripts/assets/build-shared-studio-furniture.py','license':'repository-original','invalidMesh':False,'materialSlots':[m['name'] for m in doc['materials']]}
with open(os.path.join(OUT,'build-report.json'),'w') as f:json.dump(report,f,indent=2);f.write('\n')
print('STUDIO_FURNITURE_REPORT '+json.dumps(report))

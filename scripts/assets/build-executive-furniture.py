"""Blender --background --python scripts/assets/build-executive-furniture.py
Authored for DeskRPG. No downloaded textures/models. Exports meters, Y-up, +Z front.
"""
import bpy, math, os, random, json, tempfile
import numpy as np
from mathutils import Vector
random.seed(1409)
OUT=os.path.abspath('public/assets/furniture/executive')
os.makedirs(OUT,exist_ok=True)
TEXTURES=tempfile.TemporaryDirectory(prefix="deskrpg-executive-textures-")
S=1024
y,x=np.mgrid[0:S,0:S].astype(float)/S
rng=np.random.default_rng(1409)

def image(name, rgb, color=True):
    im=bpy.data.images.new(name,width=S,height=S,alpha=True)
    im.colorspace_settings.name='sRGB' if color else 'Non-Color'
    a=np.ones((S,S,4),dtype=np.float32)
    a[:,:,:3]=np.clip(rgb,0,1)
    im.pixels.foreach_set(a.ravel())
    im.filepath_raw=os.path.join(TEXTURES.name,name+'.png'); im.file_format='PNG'; im.save()
    return im

# Non-uniform walnut pores and branching cathedral grain, not flat stripes.
warp=0.16*np.sin(y*6.28)+0.05*np.sin(y*18.85)+0.035*np.sin(x*6.28+y*12.56)
grain=np.sin((x+warp)*130)+0.38*np.sin((x+warp)*431)+0.15*np.sin(x*1711+y*21)
cloud=np.sin(x*10+y*4)*np.sin(y*17)*0.4
noise=rng.random((S,S))-.5
height=grain*.15+noise*.12+cloud
wood=image('walnut-color',np.stack([.31+height*.085,.18+height*.055,.095+height*.032],-1))
leather_h=(np.sin(x*1709+np.sin(y*641))*np.cos(y*1553+np.sin(x*381))*.2+noise*.5)
leather=image('leather-color',np.stack([.095+leather_h*.025,.072+leather_h*.022,.055+leather_h*.018],-1))
weave=np.sin(x*1900)*np.sin(y*1900)*.14+noise*.25
rug=image('rug-color',np.stack([.52+weave*.2,.43+weave*.18,.32+weave*.14],-1))

def pbr(name, col, rough, metal=0, tex=None, relief=None):
    m=bpy.data.materials.new(name); m.use_nodes=True
    n=m.node_tree.nodes; links=m.node_tree.links; bs=next((node for node in n if node.type=='BSDF_PRINCIPLED'),None)
    if bs is None:
        bs=n.new('ShaderNodeBsdfPrincipled'); output=n.new('ShaderNodeOutputMaterial');links.new(bs.outputs['BSDF'],output.inputs['Surface'])
    bs.inputs['Base Color'].default_value=(*col,1)
    bs.inputs['Roughness'].default_value=rough; bs.inputs['Metallic'].default_value=metal
    if tex:
        t=n.new('ShaderNodeTexImage');t.image=tex;links.new(t.outputs['Color'],bs.inputs['Base Color'])
    if relief is not None:
        dy,dx=np.gradient(relief)
        normal=np.stack([-dx*5,-dy*5,np.ones_like(dx)],-1)
        normal/=np.linalg.norm(normal,axis=-1)[:,:,None]
        im=image(name+'-normal',normal*.5+.5,False)
        t=n.new('ShaderNodeTexImage');t.image=im
        nm=n.new('ShaderNodeNormalMap');links.new(t.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],bs.inputs['Normal'])
        roughim=image(name+'-roughness',np.repeat(np.clip(rough+relief*.08,.1,1)[:,:,None],3,axis=2),False)
        t=n.new('ShaderNodeTexImage');t.image=roughim;links.new(t.outputs['Color'],bs.inputs['Roughness'])
    return m
W=pbr('Walnut veneer',(.3,.16,.08),.38,tex=wood,relief=height)
L=pbr('Espresso leather',(.09,.07,.05),.48,tex=leather,relief=leather_h)
R=pbr('Woven wool',(.5,.4,.3),.95,tex=rug,relief=weave)
B=pbr('Satin brass',(.58,.38,.12),.27,.78)
D=pbr('Dark bronze',(.045,.035,.028),.36,.65)
P=pbr('Ivory paper',(.72,.64,.49),.85)
C=pbr('Glazed ceramic',(.25,.28,.22),.25)
G=pbr('Leaves',(.12,.19,.055),.7)
T=pbr('Saddle seam',(.19,.13,.085),.75)

def pos(x,y,z):return (x,-z,y)
def finish(o,name,mat):
    o.name=name;o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    return o

def box(name,w,h,d,x,y,z,mat,bevel=.012):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos(x,y,z));o=bpy.context.object;o.dimensions=(w,d,h)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=o.modifiers.new('Machined or upholstered edge','BEVEL');mod.width=min(bevel,min(w,h,d)*.45);mod.segments=4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=o.modifiers.new('Weighted face normals','WEIGHTED_NORMAL');mod.keep_sharp=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,mat)

def ball(name,sizes,x,y,z,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=pos(x,y,z));o=bpy.context.object;o.scale=(sizes[0],sizes[2],sizes[1]);return finish(o,name,mat)

def rod(name,r,h,x,y,z,mat,r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=r,radius2=r if r2 is None else r2,depth=h,location=pos(x,y,z));o=bpy.context.object
    mod=o.modifiers.new('Rim bevel','BEVEL');mod.width=.004;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,mat)

def line(name,points,r,mat):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=r;curve.bevel_resolution=2
    poly=curve.splines.new('POLY');poly.points.add(len(points)-1)
    for p,v in zip(poly.points,points):p.co=(*pos(*v),1)
    o=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    return o

def plant(x,y,z,scale=1):
    rod('Ceramic planter',.07*scale,.12*scale,x,y+.06*scale,z,C,.095*scale)
    for i in range(7):
        a=i*2.4
        line('Stem',[(x,y+.1*scale,z),(x+math.cos(a)*.045*scale,y+(.23+i*.012)*scale,z+math.sin(a)*.045*scale)],.003*scale,G)
        leaf=ball('Leaf',(.018*scale,.065*scale,.01*scale),x+math.cos(a)*.052*scale,y+(.23+i*.012)*scale,z+math.sin(a)*.05*scale,G)
        leaf.rotation_euler[1]=math.sin(a)*.7

def desk():
    box('Continuous beveled walnut top',1.94,.1,.92,0,.82,0,W,.022)
    box('Bronze inset edge',1.88,.012,.86,0,.764,0,B,.004)
    for x in [-.69,.69]:
        box('Walnut pedestal',.48,.72,.73,x,.37,0,W,.014)
        box('Recessed plinth',.43,.035,.66,x,.018,0,D,.005)
        for i in range(3):
            yy=.16+i*.2
            box('Drawer front',.445,.185,.035,x,yy,-.375,W,.009)
            box('Brass drawer pull',.19,.018,.025,x,yy+.035,-.404,B,.005)
    box('Visitor modesty panel',1.39,.51,.06,0,.4,.3,W)
    box('Leather writing pad',.85,.012,.4,0,.88,-.02,L,.008)
    for z in [-.205,.165]:line('Pad stitching',[(-.4,.888,z),(.4,.888,z)],.0015,T)
    rod('Lamp base',.07,.017,.7,.88,.12,B)
    line('Gooseneck lamp',[(.7,.89,.12),(.7,1.18,.12),(.61,1.23,.12),(.55,1.23,.12)],.012,B)
    ball('Lamp shade',(.095,.04,.06),.54,1.22,.12,B)
    for i in range(3):box('Notebook pages',.22,.007,.16,-.61,.88+i*.009,.17,P,.002)
    box('Notebook cover',.235,.008,.17,-.61,.91,.17,L,.003)
    plant(-.74,.88,-.2,.75)

def executive_desk():
    # Full 4 x 2 navigation footprint. Height stays human scale.
    box('Broad walnut top',3.9,.12,1.9,0,.81,0,W,.035)
    box('Continuous brass reveal',3.82,.016,1.82,0,.743,0,B,.005)
    for x in [-1.4,1.4]:
        box('Pedestal',.65,.72,1.58,x,.36,0,W,.025)
        box('Recessed bronze plinth',.59,.05,1.5,x,.025,0,D)
        for i in range(3):
            yy=.15+i*.21
            box('Inset drawer',.60,.19,.04,x,yy,-.8,W)
            box('Brass pull',.28,.02,.025,x,yy+.025,-.83,B)
    box('Walnut modesty panel',2.85,.59,.08,0,.37,.73,W)
    box('Leather writing blotter',1.45,.018,.65,0,.885,-.43,L)
    for z in [-.73,-.13]:line('Handstitched edge',[(-.69,.897,z),(.69,.897,z)],.002,T)
    # Visitor-facing brass nameplate, text geometry travels with the GLB.
    box('Nameplate leather base',.8,.035,.19,0,.89,.68,L)
    box('Satin brass nameplate',.74,.17,.035,0,.99,.71,B)
    bpy.ops.object.text_add(location=pos(0,.955,.732))
    text=bpy.context.object;text.name='Executive nameplate lettering'
    text.data.body='EXECUTIVE';text.data.align_x='CENTER';text.data.size=.09;text.data.extrude=.001
    text.rotation_euler=(math.pi/2,0,0);text.data.materials.append(D)
    rod('Weighted lamp foot',.13,.025,1.5,.887,.25,B)
    line('Brass task lamp',[(1.5,.9,.25),(1.5,1.36,.25),(1.25,1.43,.25)],.018,B)
    ball('Task lamp shade',(.19,.065,.09),1.18,1.42,.25,B)
    for yy in [.9,.98]:
        box('Document tray',.46,.025,.34,-1.35,yy,.28,L)
        for i in range(3):box('Ivory stationery',.4,.004,.28,-1.35,yy+.018+i*.006,.28,P,.001)
    box('Telephone base',.34,.055,.22,-1.35,.905,-.45,D)
    box('Telephone handset',.32,.065,.075,-1.35,.96,-.51,L)
    for ix in range(3):
        for iz in range(3):box('Phone keypad',.026,.007,.022,-1.40+ix*.05,.937,-.44+iz*.035,P,.001)
    rod('Pen cup',.052,.14,.97,.95,-.45,L)
    for xx in [.95,.98]:rod('Brass pen',.005,.23,xx,1.04,-.45,B)
    rod('Porcelain cup',.065,.10,.92,.93,.35,P)
    rod('Leather coaster',.085,.008,.92,.883,.35,L)


def chair():
    rod('Lift column',.03,.33,0,.25,0,D)
    for i in range(5):
        a=i*math.tau/5;x=math.sin(a)*.3;z=math.cos(a)*.3
        line('Five star base',[(0,.15,0),(x,.085,z)],.025,D)
        ball('Twin caster',(.047,.045,.026),x,.047,z,D)
    box('Seat cushion',.65,.14,.6,0,.47,.01,L,.065)
    back=box('Curved back shell',.65,.78,.16,0,.91,-.27,L,.07);back.rotation_euler[0]=-.07
    for xx in [-.16,.16]:
        for yy in [.7,.94,1.17]:box('Upholstered back panel',.285,.205,.07,xx,yy,-.171,L,.03)
    for xx in [-.31,.31]:
        line('Arm support',[(xx,.36,-.15),(xx,.65,-.15),(xx,.65,.2)],.018,D)
        box('Leather arm pad',.075,.055,.43,xx,.69,.015,L,.025)
    for xx in [-.27,.27]:line('Seat seam',[(xx,.536,-.22),(xx,.536,.25)],.002,T)
    line('Top seam',[(-.25,1.29,-.18),(.25,1.29,-.18)],.002,T)

def bookcase():
    box('Back walnut panel',.98,3.34,.08,0,1.67,-.39,W)
    for xx in [-.46,.46]:box('Upright',.07,3.34,.77,xx,1.67,0,W)
    for yy in [.06,.79,1.59,2.39,3.3]:box('Shelf with rounded lip',.98,.055,.79,0,yy,0,W)
    for xx in [-.225,.225]:
        box('Lower inset door',.432,.66,.045,xx,.42,.365,W)
        box('Cabinet pull',.025,.14,.03,xx*.2,.48,.4,B,.006)
    for row,yy in enumerate([.83,1.63,2.43]):
        for i in range(3 if row==1 else 5):
            xx=-.34+i*.12;hh=.32+random.random()*.18
            bookmat=[L,P,D][i%3]
            box('Bound book',.087,hh,.27,xx,yy+hh/2,.08,bookmat,.006)
            for stripe in [.045,hh-.045]:box('Gilt spine band',.082,.008,.004,xx,yy+stripe,.218,B,.001)
        if row==1:
            rod('Ceramic vase',.085,.17,.24,yy+.085,.06,C,.05)
            rod('Vase neck',.037,.08,.24,yy+.195,.06,C)
    plant(.28,2.43,.05,.7)
    box('Warm shelf light',.81,.012,.018,0,3.25,.27,B,.002)

def rug_asset():
    box('Bound wool rug',5.9,.026,5.9,0,.013,0,R,.012)
    for v in [-2.87,2.87]:
        line('Woven bound edge',[(-2.87,.028,v),(2.87,.028,v)],.008,T)
        line('Woven bound edge',[(v,.028,-2.87),(v,.028,2.87)],.008,T)

# Shared cream upholstery and honed limestone for the second furniture pass.
linen=image('linen-color',np.stack([.70+weave*.10,.64+weave*.09,.53+weave*.08],-1))
F=pbr('Cream linen',(.7,.64,.53),.88,tex=linen,relief=weave)
saddle=image('saddle-color',np.stack([.36+leather_h*.04,.17+leather_h*.03,.08+leather_h*.02],-1))
SADDLE=pbr('Cognac leather',(.36,.17,.08),.5,tex=saddle,relief=leather_h)
veins=np.exp(-np.abs(np.sin(x*9+y*4+np.sin(y*11)*.3+np.sin(x*29+y*13)*.06))*40)
mineral=np.sin(x*30+y*17)*np.sin(y*21-x*13)*.025+noise*.015
marble=image('limestone-color',np.stack([.71+mineral-veins*.09,.65+mineral-veins*.08,.55+mineral-veins*.065],-1))
M=pbr('Honed limestone',(.71,.65,.55),.32,tex=marble,relief=mineral+veins*.03)

def guest_chair():
    for xx in [-.26,.26]:
        for zz in [-.24,.24]:line('Tapered bronze leg',[(xx*1.1,.01,zz*1.12),(xx,.47,zz)],.017,D)
    box('Seat upholstery',.66,.14,.65,0,.47,0,F,.065)
    back=box('Rounded upholstered back',.66,.62,.13,0,.79,-.265,F,.06)
    back.rotation_euler[0]=-.07
    for xx in [-.29,.29]:line('Back piping',[(xx,.55,-.19),(xx,1.04,-.19)],.003,T)

def lounge(single=False):
    width=.9 if single else 1.8
    mat=SADDLE if single else F
    for xx in [-width/2+.09,width/2-.09]:
        for zz in [-.28,.28]:rod('Bronze sofa foot',.025,.13,xx,.065,zz,D)
    box('Upholstered base',width,.22,.8,0,.24,0,mat,.065)
    centers=[0] if single else [-.38,.38]
    for xx in centers:
        cw=.66 if single else .735
        box('Independent seat cushion',cw,.17,.65,xx,.445,.045,mat,.045)
        back=box('Plump back cushion',cw,.54,.18,xx,.69,-.285,mat,.075)
        back.rotation_euler[0]=-.08
        line('Seat front piping',[(xx-cw/2+.025,.49,.376),(xx+cw/2-.025,.49,.376)],.003,T)
    for xx in [-width/2+.055,width/2-.055]:
        box('Rounded arm bolster',.11,.53,.8,xx,.45,0,mat,.05)
    if not single:
        pillow=box('Saddle accent pillow',.3,.3,.11,.56,.74,-.12,SADDLE,.06)
        pillow.rotation_euler[1]=.16

def meeting():
    top=rod('Oval walnut conference top',.91,.105,0,.815,0,W);top.scale.x=2.05
    lip=rod('Fine brass underside',.88,.012,0,.757,0,B);lip.scale.x=2.05
    for xx in [-.9,.9]:rod('Fluted pedestal',.22,.74,xx,.37,0,W)
    for xx in [-.9,.9]:
        for i in range(16):
            a=i*math.tau/16
            rod('Pedestal fluting',.018,.65,xx+math.cos(a)*.215,.37,math.sin(a)*.215,W)
    for xx in [-.7,.7]:
        for zz in [-.53,.53]:
            box('Leather conference mat',.53,.009,.3,xx,.873,zz,L,.015)
            box('Agenda',.17,.008,.21,xx,.882,zz,P,.002)
    plant(0,.874,0,1.25)

def coffee():
    rod('Stone beveled table top',.9,.095,0,.45,0,M)
    rod('Bronze reveal',.85,.015,0,.395,0,B)
    rod('Walnut drum pedestal',.42,.37,0,.19,0,W)
    rod('Dark plinth',.44,.035,0,.02,0,D)
    box('Art book',.33,.045,.25,-.2,.516,.1,P,.005)
    plant(.15,.5,-.1,1.1)


report={}
for name,build in [('executive-desk',executive_desk),('desk',desk),('chair',chair),('bookcase',bookcase),('rug',rug_asset),('guest-chair',guest_chair),('sofa',lounge),('armchair',lambda:lounge(True)),('conference',meeting),('coffee',coffee)]:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    build()
    bpy.ops.object.select_all(action='SELECT')
    # Convert curves before joining by material to bound draw calls.
    bpy.ops.object.convert(target='MESH')
    objs=list(bpy.context.selected_objects)
    # Keep object UVs (cube/lathe/sphere defaults) and bake normals/bevel geometry.
    for o in objs:
        if o.type=='MESH' and not o.data.uv_layers:
            bpy.context.view_layer.objects.active=o
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project();bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.objects.active=objs[0]
    bpy.ops.object.join()
    obj=bpy.context.object
    bounds=[obj.matrix_world @ Vector(v) for v in obj.bound_box]
    report[name]={'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),'bounds_blender':[[min(v[i] for v in bounds) for i in range(3)],[max(v[i] for v in bounds) for i in range(3)]]}
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,name+'-v1.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_extras=True,export_image_format='WEBP',export_image_quality=88)
    report[name]['bytes']=os.path.getsize(os.path.join(OUT,name+'-v1.glb'))
with open(os.path.join(OUT,'build-report.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps(report))

# Extract the already compressed, authored texture images for architectural surfaces.
import struct
for model, material_name, prefix in [('desk','Walnut veneer','walnut'),('coffee','Honed limestone','limestone')]:
    blob=open(os.path.join(OUT,model+'-v1.glb'),'rb').read()
    length=struct.unpack_from('<I',blob,12)[0]; doc=json.loads(blob[20:20+length]); data=blob[28+length:]
    material=next(m for m in doc['materials'] if m['name']==material_name)
    for key, info in [('color',material['pbrMetallicRoughness']['baseColorTexture']),('normal',material['normalTexture']),('roughness',material['pbrMetallicRoughness']['metallicRoughnessTexture'])]:
        texture=doc['textures'][info['index']]; image_index=texture.get('extensions',{}).get('EXT_texture_webp',{}).get('source',texture.get('source'))
        view=doc['bufferViews'][doc['images'][image_index]['bufferView']]; start=view.get('byteOffset',0)
        with open(os.path.join(OUT,prefix+'-'+key+'.webp'),'wb') as f:f.write(data[start:start+view['byteLength']])

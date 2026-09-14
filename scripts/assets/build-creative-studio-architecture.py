"""Original DeskRPG architecture. Blender 5.1, meters, Y-up, +Z front.
Run from repository root. Seed 140926; no downloaded models or textures.
"""
import bpy, json, math, os, struct, tempfile
import numpy as np
from mathutils import Vector
OUT=os.path.abspath('public/assets/shared/architecture')
SURF=os.path.abspath('public/assets/shared/surfaces')
os.makedirs(OUT,exist_ok=True); os.makedirs(SURF,exist_ok=True)
tmp=tempfile.TemporaryDirectory(prefix='deskrpg-studio-')
S=1024
v,u=np.mgrid[0:S,0:S].astype(float)/S
rng=np.random.default_rng(140926)

def image(name,data,color=False):
    im=bpy.data.images.new(name,width=S,height=S,alpha=True)
    im.colorspace_settings.name='sRGB' if color else 'Non-Color'
    a=np.ones((S,S,4),dtype=np.float32);a[:,:,:3]=np.clip(data,0,1)
    im.pixels.foreach_set(a.ravel());im.filepath_raw=os.path.join(tmp.name,name+'.png');im.file_format='PNG';im.save()
    return im

def material(name,color,roughness=.6,metal=0):
    m=bpy.data.materials.new(name)
    if not m.use_nodes:m.use_nodes=True
    bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness;bs.inputs['Metallic'].default_value=metal
    return m

def surface(name,rgb,height,rough):
    m=material(name,(1,1,1));nodes=m.node_tree.nodes;links=m.node_tree.links;bs=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    # Periodic central differences avoid normal seams at texture edges.
    dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*3
    dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*3
    normal=np.stack([-dx,-dy,np.ones_like(dx)],-1);normal/=np.linalg.norm(normal,axis=-1)[:,:,None]
    for key,data in [('color',rgb),('normal',normal*.5+.5),('roughness',np.repeat(rough[:,:,None],3,axis=2))]:
        node=nodes.new('ShaderNodeTexImage');node.image=image(name+'-'+key,data,key=='color')
        if key=='normal':
            nm=nodes.new('ShaderNodeNormalMap');links.new(node.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],bs.inputs['Normal'])
        else:links.new(node.outputs['Color'],bs.inputs['Base Color' if key=='color' else 'Roughness'])
    return m

# Periodic grain with staggered 3m x .25m planks. Texture repeat is 3m x 2m.
warp=.018*np.sin(v*math.tau*3)+.008*np.sin(v*math.tau*7)
grain=np.sin((v+warp*np.sin(u*math.tau))*math.tau*63)*.35+np.sin(v*math.tau*177+np.sin(u*math.tau*2))*.15
row=np.floor(v*8)
end=(u+(row%3)/3)%1
joint=(np.minimum((v*8)%1,1-(v*8)%1)<.012)|(np.minimum(end,1-end)<.0015)
noise=rng.random((S,S))-.5
h=grain*.08+noise*.035-joint*.2
base=np.stack([.79+h*.22,.70+h*.21,.56+h*.18],-1)
OAK=surface('oak',base,h,np.clip(.48+grain*.06+noise*.035+joint*.2,.25,.85))
# Running bond masonry, repeat 2m x 2m with sixteen courses and eight half bricks.
course=np.floor(v*16); bx=(u*4+(course%2)*.5)%1;by=(v*16)%1
mortar=(np.minimum(bx,1-bx)<.025)|(np.minimum(by,1-by)<.065)
brick_variation=np.sin(np.floor(u*4+(course%2)*.5)*7+course*13)*.04
h=(~mortar)*.16+noise*.045
brick=np.stack([.60+brick_variation+noise*.065,.31+brick_variation*.7+noise*.045,.20+brick_variation*.6+noise*.035],-1)
brick[mortar]=(.68,.63,.54)
BRICK=surface('brick',brick,h,np.clip(.85+noise*.08,.7,1))
plaster_h=(np.sin(u*math.tau*13)*np.cos(v*math.tau*9))*.016+noise*.028
PLASTER=surface('plaster',np.stack([.88+plaster_h,.86+plaster_h,.81+plaster_h],-1),plaster_h,np.clip(.86+noise*.05,.75,1))
STEEL=material('painted-metal',(.045,.055,.052),.34,.65)
GLASS=material('glass',(.80,.88,.88),.16,.08)
bs=next(n for n in GLASS.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Alpha'].default_value=.19
GLASS.surface_render_method='DITHERED';GLASS.use_transparent_shadow=False

def box(name,w,h,d,x,y,z,mat,bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,y));o=bpy.context.object;o.name=name;o.dimensions=(w,d,h)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    # World-unit UV projection before bevel keeps adjacent wall/floor module density stable.
    if mat in [OAK,BRICK,PLASTER]:
        uv=o.data.uv_layers.active.data
        for face in o.data.polygons:
            n=face.normal
            for idx in face.loop_indices:
                p=o.matrix_world @ o.data.vertices[o.data.loops[idx].vertex_index].co
                if abs(n.z)>.5: a,b=p.x,-p.y
                elif abs(n.y)>.5:a,b=p.x,p.z
                else:a,b=-p.y,p.z
                uv[idx].uv=(a/(3 if mat==OAK else 2),b/2)
    mod=o.modifiers.new('Soft machined edge','BEVEL');mod.width=min(bevel,min(w,h,d)*.35);mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
    for face in o.data.polygons:face.use_smooth=True
    mod=o.modifiers.new('Weighted face normals','WEIGHTED_NORMAL');mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat)
    for face in o.data.polygons:face.use_smooth=True
    return o

def pane(w=2,h=3.6,door=False,grid=False):
    for x in [-w/2+.035,w/2-.035]:box('Steel jamb',.07,h,.10,x,h/2,0,STEEL)
    for y in [.035,h-.035]:box('Steel rail',w,.07,.10,0,y,0,STEEL)
    box('Clear glazing',w-.14,h-.14,.012,0,h/2,0,GLASS,.001)
    if grid:
        for x in [-w/6,w/6]:box('Steel mullion',.035,h-.1,.065,x,h/2,.015,STEEL,.004)
        box('Window cross rail',w,.04,.07,0,h*.54,.015,STEEL,.004)
        box('Oak window sill',w,.075,.27,0,.075,.035,OAK)
    if door:
        for x in ([-.10,.10] if w>2 else [w/2-.18]):box('Pull handle',.025,.4,.075,x,1.05,.072,STEEL,.006)
        if w>2:box('Door meeting stile',.055,h,.10,0,h/2,0,STEEL)
        # Threshold is flush and never creates a navigation obstruction.
        box('Door threshold',w,.018,.2,0,.009,0,STEEL,.002)

def corner():
    pane(1)
    before=set(bpy.context.scene.objects);pane(1)
    for o in set(bpy.context.scene.objects)-before:
        o.rotation_euler.z+=math.pi/2
        x,y=o.location.x,o.location.y;o.location.x=-y-.5;o.location.y=x-.5

def export(name,build):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);build()
    bpy.ops.object.select_all(action='SELECT');objs=list(bpy.context.selected_objects)
    bpy.context.view_layer.objects.active=objs[0]
    if len(objs)>1:bpy.ops.object.join()
    o=bpy.context.object
    # Corner modules are centered on measured footprint and keep ground origin.
    if name=='glass-corner':
        pts=[o.matrix_world @ Vector(p) for p in o.bound_box]
        o.location.x-=(min(p.x for p in pts)+max(p.x for p in pts))/2
        o.location.y-=(min(p.y for p in pts)+max(p.y for p in pts))/2
    bpy.context.view_layer.update()
    invalid=o.data.validate(verbose=True)
    if invalid:raise RuntimeError('Invalid mesh repaired: '+name)
    pts=[o.matrix_world @ Vector(p) for p in o.bound_box];pts=[(p.x,p.z,-p.y) for p in pts]
    bounds=[[min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)]]
    path=os.path.join(OUT,name+'-v1.glb')
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_image_format='WEBP',export_image_quality=86,export_extras=True)
    blob=open(path,'rb').read();length=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+length]);binary=blob[28+length:]
    triangles=sum(doc['accessors'][p['indices']]['count']//3 for mesh in doc['meshes'] for p in mesh['primitives'])
    if triangles>12000 or len(blob)>2000000:raise RuntimeError('Budget exceeded: '+name)
    report[name]={'triangles':triangles,'bytes':len(blob),'bounds':{'units':'meters','min':bounds[0],'max':bounds[1]},'seed':140926,'source':__file__,'license':'repository-original','invalidMesh':False}
    for mat in doc.get('materials',[]):
        if mat['name'] not in ['oak','brick','plaster']:continue
        pbr=mat['pbrMetallicRoughness']
        for key,info in [('color',pbr['baseColorTexture']),('normal',mat['normalTexture']),('roughness',pbr['metallicRoughnessTexture'])]:
            texture=doc['textures'][info['index']];idx=texture.get('extensions',{}).get('EXT_texture_webp',{}).get('source',texture.get('source'))
            view=doc['bufferViews'][doc['images'][idx]['bufferView']];start=view.get('byteOffset',0)
            open(os.path.join(SURF,mat['name']+'-'+key+'.webp'),'wb').write(binary[start:start+view['byteLength']])

report={}
for name,build in [
 ('oak-floor',lambda:box('Oak floor module',3,.035,2,0,.0175,0,OAK,.002)),
 ('brick-panel',lambda:box('Running bond brick pier',2,3.6,.24,0,1.8,0,BRICK)),
 ('plaster-panel',lambda:box('Warm plaster panel',2,3.6,.18,0,1.8,0,PLASTER)),
 ('grid-window',lambda:pane(4,2.5,grid=True)),
 ('glass-partition',lambda:pane(2)),('glass-corner',corner),
 ('glass-door',lambda:pane(2,3.6,door=True)),
 ('double-entrance',lambda:pane(4,1.5,door=True)),
 ('cutaway-plinth',lambda:box('Pale timber cutaway edge',3,.32,.3,0,.16,0,OAK))]:export(name,build)
# Stable relative source path makes the checked-in report reproducible across worktrees.
for row in report.values():row['source']='scripts/assets/build-creative-studio-architecture.py'
with open(os.path.join(OUT,'build-report.json'),'w') as f:json.dump(report,f,indent=2);f.write('\n')
print('STUDIO_ARCHITECTURE_REPORT '+json.dumps(report))

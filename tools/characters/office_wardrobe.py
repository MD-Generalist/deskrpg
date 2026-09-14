"""Shared exportable wardrobe detail for the two supplied Quaternius skeletons.
All motion edits preserve existing bone scales. No simulated cloth or body replacement.
"""
import bpy, math, hashlib
from pathlib import Path
from mathutils import Vector, Matrix

def activate(rig, action):
    rig.animation_data.action=action
    if action.slots:rig.animation_data.action_slot=action.slots[0]

def curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves

def fabric(look, objects, materials, directory):
    """UV-project and embed a small physically colored weave image, not floating seams."""
    pattern=look.get('pattern')
    if pattern not in ['check','pinstripe','knit']:return []
    directory=Path(directory)/'fabric';directory.mkdir(parents=True,exist_ok=True)
    target=set(materials);written=[];size=256
    for material in target:
        bsdf=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        base=tuple(bsdf.inputs['Base Color'].default_value)[:3]
        image=bpy.data.images.new(look['id']+'_'+material.name+'_'+pattern,width=size,height=size,alpha=False)
        pixels=[]
        for y in range(size):
            for x in range(size):
                u=x/size;v=y/size
                if pattern=='check':
                    vertical=(x%64)<4;horizontal=(y%64)<4
                    shade=.77 if vertical or horizontal else (1.025 if (x//64+y//64)%2 else .975)
                    if x%64==8 or y%64==8:shade=.90
                elif pattern=='pinstripe':
                    shade=1.20 if x%32<2 else .995
                else:
                    # Alternating diagonal stitch legs and shallow yarn shading.
                    cellx=(x%32)/32;celly=(y%32)/32
                    ridge=abs(cellx-(.23+.48*abs(celly-.5)))
                    ridge=min(ridge,abs(cellx-(.77-.48*abs(celly-.5))))
                    shade=.86+.16*math.exp(-ridge*ridge/.008)
                weave=1+.018*math.sin(x*math.pi)*math.sin(y*math.pi/2)
                linear=[min(1,max(0,c*shade*weave)) for c in base]
                # Generated PNG pixel buffers carry sRGB channel values.
                pixels.extend([12.92*c if c<=.0031308 else 1.055*c**(1/2.4)-.055 for c in linear]+[1])
        image.pixels.foreach_set(pixels);image.filepath_raw=str(directory/(image.name+'.png'));image.file_format='PNG';image.save();image.pack()
        node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;node.extension='REPEAT';node.interpolation='Linear'
        material.node_tree.links.new(node.outputs['Color'],bsdf.inputs['Base Color']);bsdf.inputs['Roughness'].default_value=.88 if pattern=='knit' else .80
        written.append(image.filepath_raw)
    # UVs are stable rest-space metric projections, with separate front/side charts.
    # No frame-dependent shader nodes are needed by the glTF runtime.
    for obj in objects:
        if not any(m in target for m in obj.data.materials):continue
        uv=obj.data.uv_layers.new(name='OfficeFabric')
        obj.data.uv_layers.active=uv;uv.active_render=True
        normal_matrix=obj.matrix_world.to_3x3().inverted().transposed()
        for poly in obj.data.polygons:
            normal=(normal_matrix@poly.normal).normalized()
            for li in poly.loop_indices:
                p=obj.matrix_world@obj.data.vertices[obj.data.loops[li].vertex_index].co
                horizontal=p.x if abs(normal.y)>=abs(normal.x) else p.y
                uv.data[li].uv=(horizontal/.16,p.z/.16)
    return written

def author_motion(rig, actions, look, sex):
    """Restrained individual shoulder/head motion; retain supplied locomotion and scales."""
    seed=int(hashlib.sha256(look['id'].encode()).hexdigest()[:8],16)
    sign=1 if seed%2 else -1;phase=(seed%100)/100*math.tau
    stance=look['stance'];strength={'composed':.55,'relaxed':1.0,'bright':.82}[stance]
    torso='Torso' if sex=='female' else 'Spine2';head='Head'
    hand='Palm.L' if sex=='female' else 'LeftHand'
    # Use the opposite hand when the shoulder bag already occupies the left side.
    prop=look.get('bag')=='briefcase' or look.get('accessory')=='notebook'
    if look.get('accessory')=='notebook' and look.get('bag')=='shoulder':hand='Palm.R' if sex=='female' else 'RightHand'
    side='L' if hand.endswith('.L') else 'R' if hand.endswith('.R') else 'Left' if hand.startswith('Left') else 'Right'
    if sex=='female':finger_names=[n+'.'+side for n in ['MiddleHand','Fingers','Thumb2']]
    else:finger_names=[b.name for b in rig.pose.bones if b.name.startswith(side+'Hand') and any(s in b.name for s in ['Index','Middle','Ring','Pinky','Thumb']) and not b.name.endswith('4')]
    finger_names=[n for n in finger_names if n in rig.pose.bones] if prop else []
    world_z=rig.matrix_world.to_quaternion().inverted()@Vector((0,0,1))
    world_x=rig.matrix_world.to_quaternion().inverted()@Vector((1,0,0))
    for clip,action in actions.items():
        activate(rig,action);start,end=map(lambda x:int(round(x)),action.frame_range)
        names=([torso,head] if clip in ['idle','sit'] else [])+finger_names
        originals=[]
        for frame in range(start,end+1):
            bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
            originals.append({name:rig.pose.bones[name].matrix_basis.copy() for name in names})
        for frame,original in zip(range(start,end+1),originals):
            bpy.context.scene.frame_set(frame)
            for name in names:rig.pose.bones[name].matrix_basis=original[name]
            bpy.context.view_layer.update()
            t=(frame-start)/max(1,end-start)*math.tau
            wave=math.sin(t+phase)-math.sin(phase)
            for name in ([torso,head] if clip in ['idle','sit'] else []):
                bone=rig.pose.bones[name]
                # Per-look static yaw changes attitude without changing reference height.
                yaw=sign*math.radians(.45 if name==torso else 1.1)*strength
                pitch=math.radians(.24 if name==torso else .48)*strength*wave*(.70 if clip=='sit' else 1)
                m=bone.matrix.copy();origin=m.translation.copy();m.translation=(0,0,0)
                m=Matrix.Rotation(yaw,4,world_z)@Matrix.Rotation(pitch,4,world_x)@m;m.translation=origin
                saved_scale=bone.scale.copy();bone.matrix=m;bone.scale=saved_scale;bpy.context.view_layer.update()
            for name in finger_names:
                bone=rig.pose.bones[name];amount=.22 if 'Thumb' in name else .32
                bone.matrix_basis=original[name]@Matrix.Rotation(amount,4,'X')
            for name in names:
                bone=rig.pose.bones[name]
                path='rotation_quaternion' if bone.rotation_mode=='QUATERNION' else 'rotation_euler'
                bone.keyframe_insert(path,frame=frame)
        touched={rig.pose.bones[n].path_from_id('rotation_quaternion' if rig.pose.bones[n].rotation_mode=='QUATERNION' else 'rotation_euler') for n in names}
        for curve in curves(action):
            if curve.data_path in touched:
                for key in curve.keyframe_points:key.interpolation='LINEAR'
    activate(rig,actions['idle']);bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    return {'stance':stance,'phase':phase,'strength':strength,'propHand':hand if prop else None,'gripBones':finger_names}

def hand_props(rig, actions, look, sex, material, paper, objects):
    """Anchor props to the actual animated palm while retaining gravity-aligned cases.

    A dedicated bone follows the palm midpoint on every baked frame. This avoids a
    briefcase turning horizontal with a seated wrist. Fingers receive a modest grip
    in author_motion(). No collision or physical suspension simulation is claimed.
    """
    kind='briefcase' if look.get('bag')=='briefcase' else 'notebook' if look.get('accessory')=='notebook' else None
    if kind is None:return None
    hand='Palm.L' if sex=='female' else 'LeftHand'
    if kind=='notebook' and look.get('bag')=='shoulder':hand='Palm.R' if sex=='female' else 'RightHand'
    activate(rig,actions['idle']);bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    def palm():
        b=rig.pose.bones[hand];return rig.matrix_world@(b.head+(b.tail-b.head)*.65)
    start=palm();inverse=rig.matrix_world.inverted();name='OfficeHandProp'
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT');anchor=rig.data.edit_bones.new(name);anchor.head=inverse@start;anchor.tail=inverse@(start+Vector((0,0,.10)));anchor.parent=rig.data.edit_bones[hand];bpy.ops.object.mode_set(mode='OBJECT')
    side=1 if start.x>0 else -1
    def box(label,center,size,mat):
        bpy.ops.mesh.primitive_cube_add(size=1,location=center);ob=bpy.context.object;ob.name=look['id']+'_'+label
        transform=inverse@ob.matrix_world@Matrix.Diagonal(Vector((*size,1)))
        ob.data.transform(transform);ob.matrix_world=Matrix.Identity(4);ob.parent=rig;ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=Matrix.Identity(4)
        ob.data.materials.append(mat);ob.vertex_groups.new(name=name).add(list(range(len(ob.data.vertices))),1,'REPLACE');ob.modifiers.new('Palm attachment','ARMATURE').object=rig;objects.append(ob)
        return ob
    if kind=='briefcase':
        center=start+Vector((side*.025,0,-.185))
        box('HandBriefcase',center,(.235,.085,.245),material)
        box('CaseHandleGrip',start,(.105,.028,.024),material)
        for offset in [-.043,.043]:box('CaseHandleUpright',start+Vector((offset,0,-.029)),(.018,.025,.065),material)
        box('CaseClasp',center+Vector((0,-.047,.075)),(.025,.012,.030),paper)
    else:
        center=start+Vector((side*.022,-.008,-.100))
        box('HandNotebook',center,(.142,.035,.215),material)
        box('NotebookPages',center+Vector((0,-.022,0)),(.130,.009,.198),paper)
        box('NotebookSpine',center+Vector((-side*.065,0,0)),(.014,.039,.215),material)
    rest=rig.data.bones[name].matrix_local.copy();orientation=rest.to_3x3().to_4x4()
    errors=[]
    for clip,action in actions.items():
        activate(rig,action);start_frame,end=map(lambda x:int(round(x)),action.frame_range)
        for frame in range(start_frame,end+1):
            bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
            target=inverse@palm();matrix=orientation.copy();matrix.translation=target
            bone=rig.pose.bones[name];bone.matrix=matrix
            bone.keyframe_insert('location',frame=frame);bone.keyframe_insert('rotation_quaternion' if bone.rotation_mode=='QUATERNION' else 'rotation_euler',frame=frame)
            bpy.context.view_layer.update();errors.append((rig.matrix_world@bone.head-palm()).length)
        for curve in curves(action):
            if name in curve.data_path:
                for key in curve.keyframe_points:key.interpolation='LINEAR'
    activate(rig,actions['idle']);bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    return {'kind':kind,'hand':hand,'anchorBone':name,'sampledPalmErrorMax':max(errors),'attachment':'palm-parented bone; baked gravity-aligned prop orientation'}

def sweep_bounds(rig,actions,objects,shoe_materials):
    """Quarter-frame bounds and sole audit over every exported clip."""
    shoes={o:{i for p in o.data.polygons if o.data.materials[p.material_index] in shoe_materials for i in p.vertices} for o in objects}
    shoes={o:ids for o,ids in shoes.items() if ids};report={}
    for name,action in actions.items():
        activate(rig,action);lo,hi=action.frame_range;count=int(round((hi-lo)*4))+1
        minimum=1e9;maximum=-1e9;sole=1e9
        for i in range(count):
            f=lo+i/4;bpy.context.scene.frame_set(int(f),subframe=f%1);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
            # Every quarter-frame checks actual sole vertices. Full visual bounds
            # need only endpoint/midpoint samples because hands/props stay above feet.
            for o,ids in shoes.items():
                verts=o.evaluated_get(dg).data.vertices
                sole=min(sole,min((o.matrix_world@verts[j].co).z for j in ids))
            if i in [0,count//2,count-1]:
                for o in objects:
                    verts=o.evaluated_get(dg).data.vertices;points=[o.matrix_world@v.co for v in verts]
                    minimum=min(minimum,min(p.z for p in points));maximum=max(maximum,max(p.z for p in points))
        report[name]={'samples':count,'minZ':minimum,'maxZ':maximum,'soleMinZ':sole}
        assert sole>=-.002,(name,'sole penetration',sole)
    activate(rig,actions['idle']);bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    return report

def correct_ground(rig,action,objects,shoe_materials,root_name,clearance=.0002):
    """Conservative root translation envelope; never changes body or bone scale."""
    activate(rig,action);scene=bpy.context.scene;start,end=map(lambda x:int(round(x)),action.frame_range);duration=end-start
    shoes={o:{i for p in o.data.polygons if o.data.materials[p.material_index] in shoe_materials for i in p.vertices} for o in objects};shoes={o:ids for o,ids in shoes.items() if ids}
    def floor(t):
        scene.frame_set(int(t),subframe=t%1);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
        return min((o.matrix_world@o.evaluated_get(dg).data.vertices[i].co).z for o,ids in shoes.items()for i in ids)
    bone=rig.pose.bones[root_name]
    # The supplied male action contains fractional-frame root keys. Adding only
    # integer corrections leaves those intervening keys pinning feet underground.
    # Resample just root translation to the exported integer grid first; retain
    # every native limb rotation and all scale channels.
    baseline=[]
    for frame in range(start,end+1):
        scene.frame_set(frame);bpy.context.view_layer.update();baseline.append(bone.location.copy())
    for curve in curves(action):
        if curve.data_path==bone.path_from_id('location'):curve.keyframe_points.clear()
    for frame,location in zip(range(start,end+1),baseline):
        bone.location=location;bone.keyframe_insert('location',frame=frame)
    for curve in curves(action):
        if curve.data_path==bone.path_from_id('location'):
            for key in curve.keyframe_points:key.interpolation='LINEAR'
            curve.update()
    action.update_tag();rig.update_tag();bpy.context.view_layer.update()
    samples=[floor(start+i/4)for i in range(duration*4+1)]
    original=[]
    for frame in range(start,end+1):
        scene.frame_set(frame);bpy.context.view_layer.update();original.append(bone.location.copy())
    lifts=[];inverse=bone.bone.matrix_local.to_3x3().inverted()@rig.matrix_world.to_3x3().inverted()
    for frame,location in zip(range(start,end+1),original):
        nearby=[value for i,value in enumerate(samples)if min(abs(start+i/4-frame),duration-abs(start+i/4-frame))<=1]
        lift=max(0,clearance-min(nearby));lifts.append(lift)
        scene.frame_set(frame);bone.location=location+inverse@Vector((0,0,lift));bone.keyframe_insert('location',frame=frame)
    for curve in curves(action):
        if curve.data_path==bone.path_from_id('location'):
            for key in curve.keyframe_points:key.interpolation='LINEAR'
    after=[floor(start+i/4)for i in range(duration*4+1)]
    return {'samples':len(after),'beforeMin':min(samples),'afterMin':min(after),'maxAdditionalLift':max(lifts)}

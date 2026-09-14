"""Deterministic, in-place game clips for MPFB's game_engine skeleton.

Run inside Blender. ``build_actions(rig, character_world_scale)`` returns a
name -> Action mapping. The active action is idle; all clips have fake users.
Export with glTF animation mode ACTIONS, export_anim_slide_to_zero=True,
export_frame_range=False and export_bake_animation=False. If no morph animation
is intentional, export_morph_animation=False avoids an extra static mesh clip.
No NLA tracks are added, so clips cannot accidentally blend while editing.
"""

import math

import bpy
from mathutils import Quaternion, Vector


def build_actions(armature, scale_to_world: float):
    """Build idle (4 s), walk (1 s), and sit (2 s), sampled at 30 fps.

    ``scale_to_world`` is the total uniform scale from rig coordinates to game
    metres, including its parent. The sitting pelvis is 0.56 metres high.
    The rig must retain MPFB's original axes: +Z up, -Y forward.
    """
    if armature.type != 'ARMATURE' or scale_to_world <= 0:
        raise ValueError('Expected an MPFB armature and positive world scale')
    bones = armature.pose.bones
    required = ['Root', 'pelvis', 'head', 'spine_03'] + [
        f'{part}_{side}' for side in ('l', 'r')
        for part in ('upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball')
    ]
    missing = [name for name in required if name not in bones]
    if missing:
        raise ValueError(f'Missing game_engine bones: {missing}')

    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    armature.animation_data_create()
    rest = {b.name: b.bone.matrix_local.to_quaternion() for b in bones}
    local_rest = {
        b.name: (rest[b.parent.name].inverted() @ rest[b.name]
                 if b.parent else rest[b.name]) for b in bones
    }
    directions = {b.name: b.bone.tail_local - b.bone.head_local for b in bones}
    actions = {}

    def aimed(name, direction):
        return directions[name].rotation_difference(Vector(direction)) @ rest[name]

    def leg_pose(world_rotations, side, ankle, root_offset):
        thigh = bones[f'thigh_{side}'].bone
        calf = bones[f'calf_{side}'].bone
        hip = thigh.head_local + root_offset
        delta = ankle - hip
        distance = min(delta.length, thigh.length + calf.length - 0.0001)
        axis = delta.normalized()
        along = (thigh.length ** 2 - calf.length ** 2 + distance ** 2) / (2 * distance)
        outward = Vector((0, -1, 0))
        outward = (outward - axis * outward.dot(axis)).normalized()
        knee = hip + axis * along + outward * math.sqrt(max(0, thigh.length ** 2 - along ** 2))
        world_rotations[f'thigh_{side}'] = aimed(f'thigh_{side}', knee - hip)
        world_rotations[f'calf_{side}'] = aimed(f'calf_{side}', ankle - knee)

    for clip, seconds in (('idle', 4), ('walk', 1), ('sit', 2)):
        action = bpy.data.actions.new(clip)
        action.use_fake_user = True
        armature.animation_data.action = action
        actions[clip] = action
        previous_quaternions = {}
        last_frame = 1 + seconds * 30
        for frame in range(1, last_frame + 1):
            scene.frame_set(frame)
            phase = 2 * math.pi * (frame - 1) / (last_frame - 1)
            world = {}
            root_offset = Vector((0, 0, 0))
            breath = math.sin(phase)
            if clip == 'sit':
                root_offset.z = 0.56 / scale_to_world - bones['pelvis'].bone.head_local.z
            elif clip == 'walk':
                root_offset.z = -0.010 + 0.007 * math.cos(2 * phase)
                root_offset.x = 0.008 * math.cos(phase)

            # Very small thoracic expansion and gaze motion avoid a rigid idle.
            for name, amplitude in (('spine_01', 0.003), ('spine_02', 0.006), ('spine_03', 0.009)):
                if name in bones:
                    world[name] = Quaternion((1, 0, 0), amplitude * breath) @ rest[name]
            if clip == 'walk':
                world['spine_03'] = Quaternion((0, 0, 1), 0.035 * math.cos(phase)) @ rest['spine_03']
            if 'neck_01' in bones:
                world['neck_01'] = Quaternion((0, 0, 1), 0.010 * breath) @ rest['neck_01']
            world['head'] = (Quaternion((0, 0, 1), 0.016 * breath)
                             @ Quaternion((1, 0, 0), 0.008 * math.sin(phase * 2)) @ rest['head'])

            for side, sign in (('l', 1), ('r', -1)):
                swing = math.sin(phase) * sign if clip == 'walk' else 0
                upper_direction = (sign * 0.25, -0.025 - 0.28 * swing, -1)
                lower_direction = (sign * 0.17, -0.13 - 0.32 * swing, -1)
                finger_direction = Vector((sign * 0.05, -0.08 - 0.24 * swing, -1))
                if clip == 'sit':
                    upper_direction = (sign * 0.04, -0.18, -1)
                    lower_direction = (-sign * 0.10, -1, -0.45)
                    finger_direction = Vector((sign * 0.02, -1, -0.015))
                world[f'upperarm_{side}'] = aimed(f'upperarm_{side}', upper_direction)
                world[f'lowerarm_{side}'] = aimed(f'lowerarm_{side}', lower_direction)
                # MPFB's wrist bone is not parallel to the full palm. Copying
                # the forearm delta makes fingertips turn inward into clothing.
                # Aim the wrist-to-middle-fingertip axis explicitly instead.
                finger_tip = bones.get(f'middle_03_{side}')
                palm_axis = (finger_tip.bone.tail_local - bones[f'hand_{side}'].bone.head_local
                             if finger_tip else directions[f'hand_{side}'])
                world[f'hand_{side}'] = palm_axis.rotation_difference(finger_direction) @ rest[f'hand_{side}']

                ankle = bones[f'foot_{side}'].bone.head_local.copy()
                if clip == 'sit':
                    ankle.x = sign * 0.11
                    ankle.y = -0.34
                elif clip == 'walk':
                    # Swing and stance occupy half a cycle each. Toe clearance
                    # and ankle pitch are zero at both contacts.
                    ankle.y += 0.145 * swing
                    lift = max(0, -math.cos(phase) * sign)
                    ankle.z += 0.055 * lift ** 2
                    foot_pitch = 0.15 * swing * lift
                    world[f'foot_{side}'] = Quaternion((1, 0, 0), foot_pitch) @ rest[f'foot_{side}']
                    world[f'ball_{side}'] = rest[f'ball_{side}']
                leg_pose(world, side, ankle, root_offset)
                world.setdefault(f'foot_{side}', rest[f'foot_{side}'])

            # Resolve absolute armature-space orientations into parent-local
            # rotations without relying on delayed dependency-graph updates.
            resolved = {}
            for bone in bones:
                name = bone.name
                parent = resolved[bone.parent.name] if bone.parent else Quaternion()
                desired = world.get(name, parent @ local_rest[name])
                rotation = local_rest[name].inverted() @ parent.inverted() @ desired
                rotation.normalize()
                if name in previous_quaternions and rotation.dot(previous_quaternions[name]) < 0:
                    rotation.negate()
                previous_quaternions[name] = rotation.copy()
                bone.rotation_mode = 'QUATERNION'
                bone.rotation_quaternion = rotation
                bone.location = (0, 0, 0)
                bone.scale = (1, 1, 1)
                if name == 'Root':
                    bone.location = rest[name].inverted() @ root_offset
                resolved[name] = desired
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=name)
                bone.keyframe_insert('location', frame=frame, group=name)
            bpy.context.view_layer.update()

        action.use_frame_range = True
        action.frame_start = 1
        action.frame_end = last_frame
        # Blender 4.4+ stores channels in layered action channelbags.
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = 'LINEAR'
                        curve.modifiers.new('CYCLES')

    armature.animation_data.action = actions['idle']
    scene.frame_start = 1
    scene.frame_end = 121
    scene.frame_set(1)
    bpy.context.view_layer.update()
    return actions

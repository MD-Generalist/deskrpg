# Executive office work-area assets

Original DeskRPG geometry and procedural PBR textures. No third-party model or
texture downloads were incorporated. Distributed under the repository license.

Rebuild from the repository root with Blender 5.1.1:

```sh
blender --background --factory-startup --python-exit-code 1 --python scripts/assets/build-executive-furniture.py
```

GLB 2.0, meters, Y-up, +Z front, WebP embedded images (EXT_texture_webp).
Walnut, leather and wool include color, normal and roughness maps at 1024px.
The build report records file sizes, triangle counts and Blender-space bounds.
Temporary source PNGs are not shipped. These are runtime furniture only;
seat ownership and navigation remain in the shared game modules.

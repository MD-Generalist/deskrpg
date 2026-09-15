import * as T from "three";
export class MeetingWallOcclusion {
  private walls: T.Mesh[] = [];
  private originals = new Map<T.Mesh, T.Material | T.Material[]>();
  private ray = new T.Raycaster();
  constructor(private opacity = 0.12) {}
  enter(walls: T.Object3D[]) {
    this.dispose();
    const meshes = new Set<T.Mesh>();
    for (const wall of walls)
      wall.traverse((child) => {
        // Renderer splits eligible tile instances before batching, so no unrelated instance fades.
        if (child instanceof T.Mesh && !(child instanceof T.InstancedMesh)) meshes.add(child);
      });
    this.walls = [...meshes];
  }
  update(camera: T.Vector3, participants: T.Vector3[]) {
    const hidden = new Set<T.Mesh>();
    for (const wall of this.walls) wall.updateWorldMatrix(true, false);
    for (const participant of participants) {
      const direction = participant.clone().sub(camera);
      this.ray.set(camera, direction.clone().normalize());
      this.ray.far = Math.max(0, direction.length() - 0.05);
      for (const hit of this.ray.intersectObjects(this.walls, false))
        if (hit.object instanceof T.Mesh) hidden.add(hit.object);
    }
    for (const wall of this.walls) {
      if (hidden.has(wall) && !this.originals.has(wall)) {
        const original = wall.material;
        this.originals.set(wall, original);
        const clone = (material: T.Material) => {
          const copy = material.clone();
          copy.userData.meetingOcclusion = true;
          copy.opacity = Math.min(material.opacity, this.opacity);
          copy.transparent = true;
          copy.depthWrite = false;
          return copy;
        };
        wall.material = Array.isArray(original) ? original.map(clone) : clone(original);
      } else if (!hidden.has(wall)) this.restore(wall);
    }
  }
  private restore(wall: T.Mesh) {
    const original = this.originals.get(wall);
    if (!original) return;
    const copies = Array.isArray(wall.material) ? wall.material : [wall.material];
    wall.material = original;
    this.originals.delete(wall);
    for (const copy of copies) copy.dispose();
  }
  dispose() {
    for (const wall of this.originals.keys()) this.restore(wall);
    this.walls = [];
  }
}

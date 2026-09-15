import * as T from "three";

/** 원본·배치 프록시의 형상을 빌려 좌석 위에만 선택 색상을 입힌다. */
export class FurnitureHighlight {
  readonly group = new T.Group();
  private readonly material = new T.MeshBasicMaterial({
    color: "#69ba83",
    transparent: true,
    opacity: 0.32,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });
  private readonly overlays = new Map<T.Mesh, T.Mesh>();
  private readonly inverseWorld = new T.Matrix4();
  private disposed = false;

  constructor(parent?: T.Object3D) {
    this.group.name = "furniture-hover-highlight";
    this.group.userData.dynamicAsset = true;
    this.group.visible = false;
    parent?.add(this.group);
  }

  highlight(owner: T.Object3D | null) {
    if (this.disposed) return;
    if (!owner) {
      this.clear();
      return;
    }
    // 실제 숨긴 가구는 제외하고 정적 배치가 남긴 선택 프록시만 허용한다.
    for (let ancestor: T.Object3D | null = owner; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible) {
        this.clear();
        return;
      }
    }
    owner.updateWorldMatrix(true, true);
    this.group.updateWorldMatrix(true, false);
    this.inverseWorld.copy(this.group.matrixWorld).invert();
    const active = new Set<T.Mesh>();
    owner.traverse((node) => {
      if (!(node instanceof T.Mesh) || node.userData.furnitureHighlight) return;
      for (
        let ancestor: T.Object3D | null = node;
        ancestor && ancestor !== owner;
        ancestor = ancestor.parent
      )
        if (!ancestor.visible && !(ancestor === node && node.userData.seatPickProxy)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (!materials.some((material) => material.visible)) return;
      active.add(node);
      let overlay = this.overlays.get(node);
      if (!overlay) {
        overlay = new T.Mesh(node.geometry, this.material);
        overlay.name = "furniture-hover-surface";
        overlay.userData.furnitureHighlight = true;
        overlay.matrixAutoUpdate = false;
        overlay.raycast = () => {};
        overlay.renderOrder = 1;
        this.overlays.set(node, overlay);
        this.group.add(overlay);
      }
      // 에셋 교체·회전 후에도 별도 형상 복제 없이 현재 월드 좌표를 따라간다.
      overlay.geometry = node.geometry;
      overlay.matrix.multiplyMatrices(this.inverseWorld, node.matrixWorld);
      overlay.matrixWorldNeedsUpdate = true;
    });
    for (const [source, overlay] of this.overlays) {
      if (active.has(source)) continue;
      overlay.removeFromParent();
      this.overlays.delete(source);
    }
    this.group.visible = this.overlays.size > 0;
  }

  clear() {
    this.group.clear();
    this.overlays.clear();
    this.group.visible = false;
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.group.removeFromParent();
    this.material.dispose();
    this.disposed = true;
  }
}

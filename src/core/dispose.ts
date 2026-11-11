import * as THREE from 'three';

/** Removes an object from the scene and frees the GPU memory of everything under it. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mat of mats) {
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
      mat.dispose();
    }
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
  root.removeFromParent();
}

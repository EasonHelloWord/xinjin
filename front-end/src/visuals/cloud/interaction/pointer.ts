import { Camera, Plane, Raycaster, Vector2, Vector3 } from "three";

export const pointerEventToNdc = (event: PointerEvent, container: HTMLElement, out = new Vector2()): Vector2 => {
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    out.set(0, 0);
    return out;
  }
  out.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  return out;
};

export const projectPointerToPlane = (
  ndc: Vector2,
  camera: Camera,
  raycaster: Raycaster,
  plane: Plane,
  out = new Vector3()
): Vector3 | null => {
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.ray.intersectPlane(plane, out);
  return hit ?? null;
};


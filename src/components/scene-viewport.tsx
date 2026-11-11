"use client";

import { useEffect, useRef } from "react";
import {
  AmbientLight,
  AxesHelper,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Line,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type {
  CadObject,
  CadPrimitiveType,
  CadSceneData,
  Vector3Tuple,
} from "@/lib/cad-model";

export type CadSelection =
  | { kind: "object"; id: string }
  | { kind: "group"; id: string }
  | null;
export type TransformMode = "select" | "translate" | "rotate" | "scale";

interface SceneViewportProps {
  sceneData: CadSceneData;
  selection: CadSelection;
  mode: TransformMode;
  onSelect: (selection: CadSelection) => void;
  onSceneChange: (scene: CadSceneData) => void;
  onError: (message: string) => void;
}

function createGeometry(type: CadPrimitiveType) {
  switch (type) {
    case "box":
      return new BoxGeometry(1, 1, 1);
    case "sphere":
      return new SphereGeometry(0.5, 32, 24);
    case "cylinder":
      return new CylinderGeometry(0.5, 0.5, 1, 32);
  }
}

function disposeTree(root: Object3D) {
  root.traverse((child) => {
    if (!(child instanceof Mesh) && !(child instanceof Line)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
  root.clear();
}

function vectorTuple(values: { x: number; y: number; z: number }): Vector3Tuple {
  return [values.x, values.y, values.z];
}

function updateSelectionHighlight(objects: Map<string, Mesh>, selection: CadSelection) {
  for (const [id, mesh] of objects) {
    const selectedObject = selection?.kind === "object" && selection.id === id;
    const selectedGroup =
      selection?.kind === "group" && mesh.userData.cadGroupId === selection.id;
    const material = mesh.material as MeshStandardMaterial;
    material.emissive.set(selectedObject || selectedGroup ? "#3d347a" : "#000000");
    material.emissiveIntensity = selectedObject || selectedGroup ? 0.28 : 0;
  }
}

export function SceneViewport({
  sceneData,
  selection,
  mode,
  onSelect,
  onSceneChange,
  onError,
}: SceneViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef({
    sceneData,
    selection,
    mode,
    onSelect,
    onSceneChange,
    onError,
  });

  const sceneRootRef = useRef<Object3D | null>(null);
  const objectMapRef = useRef(new Map<string, Mesh>());
  const groupMapRef = useRef(new Map<string, Object3D>());
  const transformRef = useRef<TransformControls | null>(null);

  useEffect(() => {
    runtimeRef.current = { sceneData, selection, mode, onSelect, onSceneChange, onError };
  }, [sceneData, selection, mode, onSelect, onSceneChange, onError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const objectMap = objectMapRef.current;
    const groupMap = groupMapRef.current;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) {
      runtimeRef.current.onError(
        error instanceof Error ? `3D viewport unavailable: ${error.message}` : "3D viewport unavailable.",
      );
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#f6f5fb");
    const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(...runtimeRef.current.sceneData.camera.position);
    const root = new Scene();
    scene.add(root);
    sceneRootRef.current = root;

    const ambient = new AmbientLight(0xffffff, 1.65);
    const keyLight = new DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(6, 9, 5);
    scene.add(ambient, keyLight);

    const grid = new GridHelper(20, 40, 0xb9b5cb, 0xe0deea);
    const axes = new AxesHelper(1.7);
    grid.position.y = -0.006;
    scene.add(grid, axes);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor("#f6f5fb");
    host.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(...runtimeRef.current.sceneData.camera.target);
    orbit.update();

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.85);
    scene.add(transform.getHelper());
    transformRef.current = transform;

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let pointerStart: Vector2 | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pointerStart = new Vector2(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerStart || transform.dragging) {
        pointerStart = null;
        return;
      }
      const moved = pointerStart.distanceTo(new Vector2(event.clientX, event.clientY));
      pointerStart = null;
      if (moved > 4) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...objectMapRef.current.values()], false)[0];
      if (!hit) {
        runtimeRef.current.onSelect(null);
        return;
      }
      const id = hit.object.userData.cadObjectId;
      if (typeof id === "string") runtimeRef.current.onSelect({ kind: "object", id });
    };

    const commitTransform = () => {
      const current = runtimeRef.current;
      const active = current.selection;
      if (!active) return;
      if (active.kind === "object") {
        const mesh = objectMapRef.current.get(active.id);
        if (!mesh) return;
        const objects = current.sceneData.objects.map((object): CadObject =>
          object.id === active.id
            ? {
                ...object,
                position: vectorTuple(mesh.position),
                rotation: vectorTuple(mesh.rotation),
                scale: vectorTuple(mesh.scale),
              }
            : object,
        );
        current.onSceneChange({ ...current.sceneData, objects });
      } else {
        const groupObject = groupMapRef.current.get(active.id);
        if (!groupObject) return;
        const groups = current.sceneData.groups.map((group) =>
          group.id === active.id
            ? {
                ...group,
                position: vectorTuple(groupObject.position),
                rotation: vectorTuple(groupObject.rotation),
                scale: vectorTuple(groupObject.scale),
              }
            : group,
        );
        current.onSceneChange({ ...current.sceneData, groups });
      }
    };
    const onDraggingChange = (event: { value: unknown }) => {
      orbit.enabled = event.value !== true;
      if (event.value === false) commitTransform();
    };
    const onCameraChange = () => {
      const current = runtimeRef.current.sceneData;
      const position = vectorTuple(camera.position);
      const target = vectorTuple(orbit.target);
      if (
        position.some((value, index) => Math.abs(value - current.camera.position[index]) > 0.01) ||
        target.some((value, index) => Math.abs(value - current.camera.target[index]) > 0.01)
      ) {
        runtimeRef.current.onSceneChange({
          ...current,
          camera: { position, target },
        });
      }
    };
    transform.addEventListener("dragging-changed", onDraggingChange);
    orbit.addEventListener("end", onCameraChange);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    let animationFrame = 0;
    const render = () => {
      orbit.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      transform.removeEventListener("dragging-changed", onDraggingChange);
      orbit.removeEventListener("end", onCameraChange);
      transform.detach();
      transform.dispose();
      orbit.dispose();
      disposeTree(root);
      disposeTree(grid);
      disposeTree(axes);
      scene.clear();
      sceneRootRef.current = null;
      objectMap.clear();
      groupMap.clear();
      transformRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const root = sceneRootRef.current;
    if (!root) return;
    disposeTree(root);
    objectMapRef.current.clear();
    groupMapRef.current.clear();

    const groups = new Map(
      sceneData.groups.map((group) => {
        const groupObject = new Object3D();
        groupObject.name = group.name;
        groupObject.position.set(...group.position);
        groupObject.rotation.set(...group.rotation);
        groupObject.scale.set(...group.scale);
        groupObject.visible = group.visible;
        groupObject.userData.cadGroupId = group.id;
        groupMapRef.current.set(group.id, groupObject);
        root.add(groupObject);
        return [group.id, groupObject] as const;
      }),
    );

    for (const object of sceneData.objects) {
      const mesh = new Mesh(
        createGeometry(object.type),
        new MeshStandardMaterial({ color: object.color, roughness: 0.62, metalness: 0.04 }),
      );
      mesh.name = object.name;
      mesh.position.set(...object.position);
      mesh.rotation.set(...object.rotation);
      mesh.scale.set(...object.scale);
      mesh.visible = object.visible;
      mesh.userData.cadObjectId = object.id;
      mesh.userData.cadGroupId = object.groupId;
      const parent = object.groupId ? groups.get(object.groupId) : undefined;
      (parent ?? root).add(mesh);
      objectMapRef.current.set(object.id, mesh);
    }
  }, [sceneData]);

  useEffect(() => {
    const transform = transformRef.current;
    if (!transform) return;
    transform.setMode(mode === "select" ? "translate" : mode);
    const target = selection
      ? selection.kind === "object"
        ? objectMapRef.current.get(selection.id)
        : groupMapRef.current.get(selection.id)
      : undefined;
    if (mode === "select" || !target) transform.detach();
    else transform.attach(target);
  }, [sceneData, selection, mode]);

  useEffect(() => {
    updateSelectionHighlight(objectMapRef.current, selection);
  }, [sceneData, selection]);

  return (
    <div
      aria-label="Interactive 3D design viewport"
      className="cad-viewport"
      ref={hostRef}
      role="application"
    />
  );
}

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
import type { RigidBody, World } from "@dimforge/rapier3d-compat";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CadPrimitiveType } from "@/lib/cad-model";
import {
  setBodyPosition,
  setBodyRotationFromQuaternion,
  toPhysicsRotation,
  type ExperimentObject,
  type ExperimentSceneData,
} from "@/lib/experiment-model";

interface PhysicsViewportProps {
  sceneData: ExperimentSceneData;
  running: boolean;
  onSelect: (id: string | null) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onSimulationStop: (scene: ExperimentSceneData) => void;
}

interface SimulatedObject {
  body: RigidBody;
  mesh: Mesh;
}

interface PhysicsRuntime {
  world: World;
  objects: Map<string, SimulatedObject>;
}

let rapierModule: Promise<typeof import("@dimforge/rapier3d-compat")> | undefined;

function loadRapier() {
  rapierModule ??= import("@dimforge/rapier3d-compat")
    .then(async (rapier) => {
      await rapier.init();
      return rapier;
    })
    .catch((error: unknown) => {
      rapierModule = undefined;
      throw error;
    });
  return rapierModule;
}

function createGeometry(type: CadPrimitiveType) {
  switch (type) {
    case "box":
      return new BoxGeometry(1, 1, 1);
    case "sphere":
      return new SphereGeometry(0.5, 24, 16);
    case "cylinder":
      return new CylinderGeometry(0.5, 0.5, 1, 24);
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

function colliderForObject(
  rapier: typeof import("@dimforge/rapier3d-compat"),
  object: ExperimentObject,
  geometry: ReturnType<typeof createGeometry>,
) {
  const positions = geometry.getAttribute("position");
  const vertices = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    vertices[index * 3] = positions.getX(index) * object.scale[0];
    vertices[index * 3 + 1] = positions.getY(index) * object.scale[1];
    vertices[index * 3 + 2] = positions.getZ(index) * object.scale[2];
  }
  const collider = rapier.ColliderDesc.convexHull(vertices);
  if (!collider) throw new Error(`Could not create a physics collider for “${object.name}”.`);
  collider.setFriction(0.72).setRestitution(0.18);
  if (object.bodyType === "dynamic") collider.setMass(object.mass);
  return collider;
}

export function PhysicsViewport({
  sceneData,
  running,
  onSelect,
  onReady,
  onError,
  onSimulationStop,
}: PhysicsViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<Object3D | null>(null);
  const physicsRef = useRef<PhysicsRuntime | null>(null);
  const initialCameraRef = useRef(sceneData.camera);
  const runningRef = useRef(running);
  const callbacksRef = useRef({ onSelect, onReady, onError, onSimulationStop });
  const previousRunningRef = useRef(running);

  useEffect(() => {
    runningRef.current = running;
    if (previousRunningRef.current && !running && physicsRef.current) {
      const current = physicsRef.current;
      const objects = sceneData.objects.map((object) => {
        const simulated = current.objects.get(object.id);
        if (!simulated) return object;
        const position = simulated.body.translation();
        const rotation = simulated.body.rotation();
        return {
          ...object,
          position: setBodyPosition(position),
          rotation: setBodyRotationFromQuaternion(rotation),
        };
      });
      onSimulationStop({ ...sceneData, objects });
    }
    previousRunningRef.current = running;
  }, [running, sceneData, onSimulationStop]);

  useEffect(() => {
    callbacksRef.current = { onSelect, onReady, onError, onSimulationStop };
  }, [onSelect, onReady, onError, onSimulationStop]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) {
      callbacksRef.current.onError(
        error instanceof Error ? `3D viewport unavailable: ${error.message}` : "3D viewport unavailable.",
      );
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#f6f5fb");
    const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(...initialCameraRef.current.position);
    const ambient = new AmbientLight(0xffffff, 1.65);
    const keyLight = new DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(6, 9, 5);
    const grid = new GridHelper(20, 40, 0xb9b5cb, 0xe0deea);
    const axes = new AxesHelper(1.7);
    const floor = new Mesh(
      new BoxGeometry(20, 0.2, 20),
      new MeshStandardMaterial({ color: "#e5e3ed", roughness: 0.9 }),
    );
    floor.position.y = -0.1;
    scene.add(ambient, keyLight, grid, axes, floor);

    const root = new Object3D();
    rootRef.current = root;
    scene.add(root);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor("#f6f5fb");
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(...initialCameraRef.current.target);
    controls.update();

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
      if (!pointerStart) return;
      const moved = pointerStart.distanceTo(new Vector2(event.clientX, event.clientY));
      pointerStart = null;
      if (moved > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const meshes = physicsRef.current
        ? [...physicsRef.current.objects.values()].map((item) => item.mesh)
        : [];
      const hit = raycaster.intersectObjects(meshes, false)[0];
      const id = hit?.object.userData.experimentObjectId;
      callbacksRef.current.onSelect(typeof id === "string" ? id : null);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    let previousFrame = performance.now();
    let accumulator = 0;
    let animationFrame = 0;
    const render = (now: number) => {
      const runtime = physicsRef.current;
      if (runtime && runningRef.current) {
        accumulator += Math.min((now - previousFrame) / 1000, 0.1);
        const step = runtime.world.timestep;
        while (accumulator >= step) {
          runtime.world.step();
          accumulator -= step;
        }
        for (const { body, mesh } of runtime.objects.values()) {
          const position = body.translation();
          const rotation = body.rotation();
          mesh.position.set(position.x, position.y, position.z);
          mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        }
      }
      previousFrame = now;
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render(previousFrame);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      disposeTree(root);
      disposeTree(grid);
      disposeTree(axes);
      disposeTree(floor);
      scene.clear();
      rootRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let world: World | null = null;
    let root: Object3D | null = null;

    async function buildPhysicsWorld() {
      const rapier = await loadRapier();
      if (disposed) return;
      root = rootRef.current;
      if (!root) throw new Error("The experiment viewport is not ready.");
      const previous = physicsRef.current;
      previous?.world.free();
      physicsRef.current = null;
      disposeTree(root);

      world = new rapier.World({ x: sceneData.gravity[0], y: sceneData.gravity[1], z: sceneData.gravity[2] });
      world.timestep = 1 / 60;
      const floorBody = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0),
      );
      world.createCollider(rapier.ColliderDesc.cuboid(10, 0.1, 10).setFriction(0.9), floorBody);
      const objects = new Map<string, SimulatedObject>();

      for (const object of sceneData.objects) {
        const bodyDescription = object.bodyType === "dynamic"
          ? rapier.RigidBodyDesc.dynamic()
          : rapier.RigidBodyDesc.fixed();
        const body = world.createRigidBody(
          bodyDescription
            .setTranslation(...object.position)
            .setRotation(toPhysicsRotation(object.rotation))
            .setCcdEnabled(object.bodyType === "dynamic"),
        );
        const geometry = createGeometry(object.type);
        const mesh = new Mesh(
          geometry,
          new MeshStandardMaterial({ color: object.color, roughness: 0.62, metalness: 0.04 }),
        );
        mesh.name = object.name;
        mesh.position.set(...object.position);
        mesh.rotation.set(...object.rotation);
        mesh.scale.set(...object.scale);
        mesh.visible = object.visible;
        mesh.userData.experimentObjectId = object.id;
        root.add(mesh);
        const collider = colliderForObject(rapier, object, geometry);
        world.createCollider(collider, body);
        objects.set(object.id, { body, mesh });
      }

      if (disposed) {
        world.free();
        return;
      }
      physicsRef.current = { world, objects };
      callbacksRef.current.onReady();
    }

    buildPhysicsWorld().catch((error: unknown) => {
      if (!disposed) {
        world?.free();
        world = null;
        if (root) disposeTree(root);
        callbacksRef.current.onError(
          error instanceof Error ? error.message : "Could not initialize the physics scene.",
        );
      }
    });

    return () => {
      disposed = true;
      if (world) world.free();
      if (physicsRef.current?.world === world) physicsRef.current = null;
      if (root) disposeTree(root);
    };
  }, [sceneData]);

  return (
    <div
      aria-label="Interactive physics viewport"
      className="cad-viewport physics-viewport"
      ref={hostRef}
      role="application"
    />
  );
}

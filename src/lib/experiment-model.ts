import { Euler, Quaternion } from "three";
import {
  dissolveCadAssembly,
  parseCadScene,
  type CadPrimitiveType,
  type CadSceneData,
  type Vector3Tuple,
} from "@/lib/cad-model";

export type PhysicsBodyType = "dynamic" | "fixed";

export interface ExperimentObject {
  id: string;
  name: string;
  type: CadPrimitiveType;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
  color: string;
  visible: boolean;
  bodyType: PhysicsBodyType;
  mass: number;
}

export interface ExperimentSceneData {
  version: 1;
  gravity: Vector3Tuple;
  camera: {
    position: Vector3Tuple;
    target: Vector3Tuple;
  };
  objects: ExperimentObject[];
}

const DEFAULT_GRAVITY: Vector3Tuple = [0, -9.81, 0];
const DEFAULT_CAMERA = { position: [6, 5, 7] as Vector3Tuple, target: [0, 0.75, 0] as Vector3Tuple };

export function createEmptyExperimentScene(): ExperimentSceneData {
  return {
    version: 1,
    gravity: [...DEFAULT_GRAVITY],
    camera: {
      position: [...DEFAULT_CAMERA.position],
      target: [...DEFAULT_CAMERA.target],
    },
    objects: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVector(value: unknown, label: string, positive = false): Vector3Tuple {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    throw new Error(`The saved ${label} must contain three finite numbers.`);
  }
  const vector = value as Vector3Tuple;
  if (positive && vector.some((part) => part <= 0)) {
    throw new Error(`The saved ${label} values must be greater than zero.`);
  }
  return [...vector];
}

function parseObject(value: unknown): ExperimentObject {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    (value.type !== "box" && value.type !== "sphere" && value.type !== "cylinder") ||
    typeof value.color !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(value.color) ||
    typeof value.visible !== "boolean" ||
    (value.bodyType !== "dynamic" && value.bodyType !== "fixed") ||
    typeof value.mass !== "number" ||
    !Number.isFinite(value.mass) ||
    value.mass <= 0
  ) {
    throw new Error("A saved experiment body is malformed.");
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    position: parseVector(value.position, "body position"),
    rotation: parseVector(value.rotation, "body rotation"),
    scale: parseVector(value.scale, "body scale", true),
    color: value.color,
    visible: value.visible,
    bodyType: value.bodyType,
    mass: value.mass,
  };
}

export function parseExperimentScene(value: unknown): ExperimentSceneData {
  if (Array.isArray(value) && value.length === 0) return createEmptyExperimentScene();
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.objects)) {
    throw new Error("This experiment has an unsupported or malformed scene.");
  }
  const objects = value.objects.map(parseObject);
  if (new Set(objects.map((object) => object.id)).size !== objects.length) {
    throw new Error("The experiment contains duplicate body identifiers.");
  }
  let gravity = DEFAULT_GRAVITY;
  let camera = DEFAULT_CAMERA;
  if (value.gravity !== undefined) gravity = parseVector(value.gravity, "gravity");
  if (value.camera !== undefined) {
    if (!isRecord(value.camera)) throw new Error("The experiment camera settings are malformed.");
    camera = {
      position: parseVector(value.camera.position, "camera position"),
      target: parseVector(value.camera.target, "camera target"),
    };
  }
  return { version: 1, gravity, camera, objects };
}

export function addExperimentBody(
  scene: ExperimentSceneData,
  type: CadPrimitiveType,
  id: string,
): { scene: ExperimentSceneData; object: ExperimentObject } {
  const sameTypeCount = scene.objects.filter((object) => object.type === type).length;
  const labels: Record<CadPrimitiveType, string> = {
    box: "Box",
    sphere: "Sphere",
    cylinder: "Cylinder",
  };
  const object: ExperimentObject = {
    id,
    name: `${labels[type]} ${sameTypeCount + 1}`,
    type,
    position: [scene.objects.length * 1.35, 2 + scene.objects.length * 0.2, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: type === "box" ? "#8170e8" : type === "sphere" ? "#e59a61" : "#62a98b",
    visible: true,
    bodyType: "dynamic",
    mass: 1,
  };
  return { scene: { ...scene, objects: [...scene.objects, object] }, object };
}

export function importCadScene(sceneValue: unknown, idFactory: () => string): ExperimentSceneData {
  let scene: CadSceneData = parseCadScene(sceneValue);
  for (const group of [...scene.groups]) scene = dissolveCadAssembly(scene, group.id);
  const experiment = createEmptyExperimentScene();
  const objects = scene.objects.map((object) => ({
    id: idFactory(),
    name: object.name,
    type: object.type,
    position: [...object.position] as Vector3Tuple,
    rotation: [...object.rotation] as Vector3Tuple,
    scale: [...object.scale] as Vector3Tuple,
    color: object.color,
    visible: object.visible,
    bodyType: "dynamic" as const,
    mass: 1,
  }));
  return { ...experiment, camera: scene.camera, objects };
}

export function setBodyRotationFromQuaternion(rotation: { x: number; y: number; z: number; w: number }): Vector3Tuple {
  const euler = new Euler().setFromQuaternion(new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
  return [euler.x, euler.y, euler.z];
}

export function setBodyPosition(position: { x: number; y: number; z: number }): Vector3Tuple {
  return [position.x, position.y, position.z];
}

export function toPhysicsRotation(rotation: Vector3Tuple) {
  const quaternion = new Quaternion().setFromEuler(new Euler(...rotation));
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

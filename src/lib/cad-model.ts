import { Euler, Matrix4, Quaternion, Vector3 } from "three";

export type CadPrimitiveType = "box" | "sphere" | "cylinder";
export type Vector3Tuple = [number, number, number];

export interface CadObject {
  id: string;
  name: string;
  type: CadPrimitiveType;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
  color: string;
  visible: boolean;
  groupId: string | null;
}

export interface CadGroup {
  id: string;
  name: string;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
  visible: boolean;
}

export interface CadCameraState {
  position: Vector3Tuple;
  target: Vector3Tuple;
}

export interface CadSceneData {
  version: 1;
  objects: CadObject[];
  groups: CadGroup[];
  camera: CadCameraState;
}

const DEFAULT_CAMERA: CadCameraState = {
  position: [6, 5, 7],
  target: [0, 0.5, 0],
};

const ZERO: Vector3Tuple = [0, 0, 0];
const ONE: Vector3Tuple = [1, 1, 1];

export function createEmptyCadScene(): CadSceneData {
  return {
    version: 1,
    objects: [],
    groups: [],
    camera: {
      position: [...DEFAULT_CAMERA.position],
      target: [...DEFAULT_CAMERA.target],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVector(value: unknown, label: string, allowZero = true): Vector3Tuple {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    throw new Error(`The saved ${label} must contain three finite numbers.`);
  }
  const vector = value as Vector3Tuple;
  if (!allowZero && vector.some((part) => part <= 0)) {
    throw new Error(`The saved ${label} values must be greater than zero.`);
  }
  return [...vector];
}

function parseCadObject(value: unknown): CadObject {
  if (!isRecord(value)) throw new Error("A saved CAD object is malformed.");
  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    (value.type !== "box" && value.type !== "sphere" && value.type !== "cylinder") ||
    typeof value.color !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(value.color) ||
    typeof value.visible !== "boolean" ||
    !(value.groupId === null || (typeof value.groupId === "string" && value.groupId.length > 0))
  ) {
    throw new Error("A saved CAD object is malformed.");
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    position: readVector(value.position, "object position"),
    rotation: readVector(value.rotation, "object rotation"),
    scale: readVector(value.scale, "object scale", false),
    color: value.color,
    visible: value.visible,
    groupId: value.groupId,
  };
}

function parseCadGroup(value: unknown): CadGroup {
  if (!isRecord(value)) throw new Error("A saved assembly is malformed.");
  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    typeof value.visible !== "boolean"
  ) {
    throw new Error("A saved assembly is malformed.");
  }
  return {
    id: value.id,
    name: value.name,
    position: readVector(value.position, "assembly position"),
    rotation: readVector(value.rotation, "assembly rotation"),
    scale: readVector(value.scale, "assembly scale", false),
    visible: value.visible,
  };
}

export function parseCadScene(value: unknown): CadSceneData {
  if (Array.isArray(value) && value.length === 0) return createEmptyCadScene();
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.objects) ||
    !Array.isArray(value.groups)
  ) {
    throw new Error("This CAD project has an unsupported or malformed scene.");
  }

  const objects = value.objects.map(parseCadObject);
  const groups = value.groups.map(parseCadGroup);
  const groupIds = new Set(groups.map((group) => group.id));
  const objectIds = new Set(objects.map((object) => object.id));
  if (groupIds.size !== groups.length || objectIds.size !== objects.length) {
    throw new Error("The saved CAD scene contains duplicate identifiers.");
  }
  if (objects.some((object) => object.groupId && !groupIds.has(object.groupId))) {
    throw new Error("The saved CAD scene refers to a missing assembly.");
  }

  let camera = DEFAULT_CAMERA;
  if (value.camera !== undefined) {
    if (!isRecord(value.camera)) throw new Error("The saved camera settings are malformed.");
    camera = {
      position: readVector(value.camera.position, "camera position"),
      target: readVector(value.camera.target, "camera target"),
    };
  }

  return { version: 1, objects, groups, camera };
}

export function addCadPrimitive(
  scene: CadSceneData,
  type: CadPrimitiveType,
  id: string,
): { scene: CadSceneData; object: CadObject } {
  const sameTypeCount = scene.objects.filter((object) => object.type === type).length;
  const labels: Record<CadPrimitiveType, string> = {
    box: "Box",
    sphere: "Sphere",
    cylinder: "Cylinder",
  };
  const object: CadObject = {
    id,
    name: `${labels[type]} ${sameTypeCount + 1}`,
    type,
    position: [scene.objects.length * 1.35, 0.5, 0],
    rotation: [...ZERO],
    scale: [...ONE],
    color: type === "box" ? "#8170e8" : type === "sphere" ? "#e59a61" : "#62a98b",
    visible: true,
    groupId: null,
  };
  return { scene: { ...scene, objects: [...scene.objects, object] }, object };
}

export function createCadAssembly(
  scene: CadSceneData,
  objectIds: string[],
  id: string,
): CadSceneData {
  const uniqueIds = new Set(objectIds);
  const parts = scene.objects.filter((object) => uniqueIds.has(object.id));
  if (parts.length < 2 || parts.length !== uniqueIds.size) {
    throw new Error("Select at least two existing components to create an assembly.");
  }
  if (parts.some((object) => object.groupId !== null)) {
    throw new Error("Ungroup selected components before putting them in a new assembly.");
  }

  const position: Vector3Tuple = [
    parts.reduce((sum, object) => sum + object.position[0], 0) / parts.length,
    parts.reduce((sum, object) => sum + object.position[1], 0) / parts.length,
    parts.reduce((sum, object) => sum + object.position[2], 0) / parts.length,
  ];
  const group: CadGroup = {
    id,
    name: `Assembly ${scene.groups.length + 1}`,
    position,
    rotation: [...ZERO],
    scale: [...ONE],
    visible: true,
  };
  return {
    ...scene,
    groups: [...scene.groups, group],
    objects: scene.objects.map((object) =>
      uniqueIds.has(object.id)
        ? {
            ...object,
            groupId: id,
            position: [
              object.position[0] - position[0],
              object.position[1] - position[1],
              object.position[2] - position[2],
            ],
          }
        : object,
    ),
  };
}

function composeTransform(position: Vector3Tuple, rotation: Vector3Tuple, scale: Vector3Tuple) {
  return new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(...rotation)),
    new Vector3(...scale),
  );
}

export function dissolveCadAssembly(scene: CadSceneData, groupId: string): CadSceneData {
  const group = scene.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error("The selected assembly no longer exists.");
  const groupTransform = composeTransform(group.position, group.rotation, group.scale);

  const objects = scene.objects.map((object) => {
    if (object.groupId !== groupId) return object;
    const worldTransform = groupTransform.clone().multiply(
      composeTransform(object.position, object.rotation, object.scale),
    );
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    worldTransform.decompose(position, rotation, scale);
    const euler = new Euler().setFromQuaternion(rotation);
    return {
      ...object,
      groupId: null,
      position: [position.x, position.y, position.z] as Vector3Tuple,
      rotation: [euler.x, euler.y, euler.z] as Vector3Tuple,
      scale: [scale.x, scale.y, scale.z] as Vector3Tuple,
    };
  });

  return {
    ...scene,
    groups: scene.groups.filter((candidate) => candidate.id !== groupId),
    objects,
  };
}

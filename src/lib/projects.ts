import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  parseCadScene,
  type CadSceneData,
} from "@/lib/cad-model";
import {
  parseExperimentScene,
  type ExperimentSceneData,
} from "@/lib/experiment-model";

export type ProjectKind = "craft" | "experiment";

interface ProjectMetadata {
  id: string;
  title: string;
  updatedAt: number;
}

export interface CraftProjectRecord extends ProjectMetadata {
  kind: "craft";
  scene: CadSceneData;
}

export interface ExperimentProjectRecord extends ProjectMetadata {
  kind: "experiment";
  scene: ExperimentSceneData;
}

export type ProjectRecord = CraftProjectRecord | ExperimentProjectRecord;

export interface ProjectListResult {
  projects: ProjectRecord[];
  warnings: string[];
}

interface StoredProjectRecord extends ProjectMetadata {
  kind: ProjectKind;
  scene: unknown;
}

interface FusionCraftDB extends DBSchema {
  projects: {
    key: string;
    value: StoredProjectRecord;
    indexes: { "by-kind": ProjectKind; "by-updated": number };
  };
  settings: {
    key: string;
    value: { key: string; value: unknown };
  };
}

const DATABASE_NAME = "fusioncraft-hub";
const DATABASE_VERSION = 1;
let databasePromise: Promise<IDBPDatabase<FusionCraftDB>> | undefined;
let projectWriteQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function database(): Promise<IDBPDatabase<FusionCraftDB>> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }

  databasePromise ??= openDB<FusionCraftDB>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("projects")) {
        const projects = db.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("by-kind", "kind");
        projects.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    },
  }).catch((error: unknown) => {
    databasePromise = undefined;
    throw new Error("Could not open the local project database.", { cause: error });
  });

  return databasePromise;
}

function enqueueProjectWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = projectWriteQueue.then(write, write);
  projectWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

function normalizeProject(project: StoredProjectRecord): ProjectRecord {
  if (
    !project ||
    typeof project.id !== "string" ||
    !project.id ||
    (project.kind !== "craft" && project.kind !== "experiment") ||
    typeof project.title !== "string" ||
    !project.title.trim() ||
    !Number.isFinite(project.updatedAt)
  ) {
    throw new Error("Saved project data is malformed.");
  }

  const metadata = {
    id: project.id,
    title: project.title,
    updatedAt: project.updatedAt,
  };
  if (project.kind === "craft") {
    return { ...metadata, kind: "craft", scene: parseCadScene(project.scene) };
  }
  return { ...metadata, kind: "experiment", scene: parseExperimentScene(project.scene) };
}

function projectLabel(project: unknown): string {
  if (!isRecord(project)) return "A saved project with unreadable metadata";
  const title = typeof project.title === "string" && project.title.trim()
    ? `“${project.title}”`
    : "A saved project";
  const id = typeof project.id === "string" && project.id ? ` (${project.id})` : "";
  return `${title}${id}`;
}

export async function listProjects(kind?: ProjectKind): Promise<ProjectListResult> {
  const db = await database();
  const storedRecords = kind
    ? await db.getAllFromIndex("projects", "by-kind", kind)
    : await db.getAll("projects");
  const projects: ProjectRecord[] = [];
  const warnings: string[] = [];
  for (const record of storedRecords) {
    try {
      projects.push(normalizeProject(record));
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "The saved data is malformed.";
      warnings.push(`${projectLabel(record)} could not be loaded: ${reason} Its stored data was left unchanged.`);
    }
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return { projects, warnings };
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  await saveProjectsAtomically([project]);
}

export async function saveProjectsAtomically(projects: ProjectRecord[]): Promise<void> {
  const validated = projects.map(normalizeProject);
  if (!validated.length || new Set(validated.map((project) => project.id)).size !== validated.length) {
    throw new Error("A project save must contain unique project records.");
  }

  await enqueueProjectWrite(async () => {
    const db = await database();
    const transaction = db.transaction("projects", "readwrite");
    await Promise.all([
      Promise.all(validated.map((project) => transaction.store.put(project))),
      transaction.done,
    ]);
  });
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  const db = await database();
  const project = await db.get("projects", id);
  return project ? normalizeProject(project) : undefined;
}

export async function deleteProject(id: string): Promise<void> {
  await enqueueProjectWrite(async () => {
    const db = await database();
    const transaction = db.transaction("projects", "readwrite");
    await Promise.all([transaction.store.delete(id), transaction.done]);
  });
}

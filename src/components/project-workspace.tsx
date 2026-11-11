"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AppLink } from "@/components/app-link";
import {
  deleteProject,
  getProject,
  listProjects,
  saveProject,
  saveProjectsAtomically,
  type ProjectKind,
  type ProjectRecord,
} from "@/lib/projects";
import { createEmptyCadScene } from "@/lib/cad-model";
import type { CadSceneData } from "@/lib/cad-model";
import { CadEditor } from "@/components/cad-editor";
import { ExperimentEditor } from "@/components/experiment-editor";
import {
  createEmptyExperimentScene,
  importCadScene,
  type ExperimentSceneData,
} from "@/lib/experiment-model";
import {
  projectOperationReducer,
  type ProjectOperationAction,
  type ProjectOperationState,
} from "@/lib/project-operation";

interface ProjectWorkspaceProps {
  kind: ProjectKind;
  title: string;
  description: string;
  accent: "violet" | "orange";
}

function currentTimestamp() {
  return Date.now();
}

export function ProjectWorkspace({
  kind,
  title,
  description,
  accent,
}: ProjectWorkspaceProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [operation, dispatchOperation] = useReducer(projectOperationReducer, {
    status: "loading",
    task: "library",
  });
  const operationRef = useRef<ProjectOperationState>({ status: "loading", task: "library" });
  const blockingOperationRef = useRef(false);
  const activeProjectRef = useRef<ProjectRecord | null>(null);
  const pendingSaveRef = useRef<ProjectRecord | null>(null);
  const failedSaveRef = useRef<ProjectRecord | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushSavesRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));

  const transitionOperation = useCallback((action: ProjectOperationAction) => {
    operationRef.current = projectOperationReducer(operationRef.current, action);
    dispatchOperation(action);
  }, []);
  const isOperationBusy = operation.status === "loading" ||
    operation.status === "saving" ||
    operation.status === "transferring";

  const refreshProjects = useCallback(async () => {
    const result = await listProjects(kind);
    setProjects(result.projects);
    setLoadWarnings(result.warnings);
  }, [kind]);

  async function retryLibraryLoad() {
    if (blockingOperationRef.current) return;
    blockingOperationRef.current = true;
    transitionOperation({ type: "start", operation: { status: "loading", task: "library" } });
    try {
      await refreshProjects();
      transitionOperation({ type: "finish" });
    } catch (cause) {
      transitionOperation({
        type: "fail",
        task: "library",
        message: cause instanceof Error ? cause.message : "Could not load projects.",
      });
    } finally {
      blockingOperationRef.current = false;
    }
  }

  useEffect(() => {
    let active = true;
    listProjects(kind)
      .then(({ projects: loadedProjects, warnings }) => {
        if (active) {
          setProjects(loadedProjects);
          setLoadWarnings(warnings);
          transitionOperation({ type: "finish" });
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          transitionOperation({
            type: "fail",
            task: "library",
            message: cause instanceof Error ? cause.message : "Could not load projects.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [kind, transitionOperation]);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockingOperationRef.current) return;
    blockingOperationRef.current = true;
    setError("");
    setNotice("");
    const cleanTitle = projectTitle.trim();
    if (!cleanTitle) {
      setError("Enter a project name before saving.");
      blockingOperationRef.current = false;
      return;
    }

    const metadata = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      updatedAt: currentTimestamp(),
    };
    const record: ProjectRecord = kind === "craft"
      ? { ...metadata, kind: "craft", scene: createEmptyCadScene() }
      : { ...metadata, kind: "experiment", scene: createEmptyExperimentScene() };

    try {
      transitionOperation({
        type: "start",
        operation: { status: "saving", projectId: record.id },
      });
      await saveProject(record);
      setProjectTitle("");
      await refreshProjects();
      activeProjectRef.current = record;
      setActiveProject(record);
      transitionOperation({ type: "finish" });
    } catch (cause) {
      failedSaveRef.current = record;
      transitionOperation({
        type: "fail",
        task: "save",
        projectId: record.id,
        message: cause instanceof Error ? cause.message : "Could not save this project.",
      });
    } finally {
      blockingOperationRef.current = false;
    }
  }

  async function openProject(project: ProjectRecord) {
    if (blockingOperationRef.current) return;
    blockingOperationRef.current = true;
    setError("");
    setNotice("");
    transitionOperation({
      type: "start",
      operation: { status: "loading", task: "load", projectId: project.id },
    });
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const savedProject = await getProject(project.id);
      if (!savedProject || savedProject.kind !== kind) {
        throw new Error("This project is no longer available in the local library.");
      }
      activeProjectRef.current = savedProject;
      setActiveProject(savedProject);
      transitionOperation({ type: "finish" });
    } catch (cause) {
      transitionOperation({
        type: "fail",
        task: "load",
        projectId: project.id,
        message: cause instanceof Error ? cause.message : "Could not open this project.",
      });
    } finally {
      blockingOperationRef.current = false;
    }
  }

  const runSaveQueue = useCallback(async (): Promise<boolean> => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const task = (async () => {
      while (pendingSaveRef.current) {
        const snapshot = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (operationRef.current.status !== "transferring") {
          transitionOperation({ type: "start", operation: { status: "saving", projectId: snapshot.id } });
        }
        try {
          await saveProject(snapshot);
          failedSaveRef.current = null;
          setProjects((current) => {
            const index = current.findIndex((project) => project.id === snapshot.id);
            if (index < 0) return snapshot.kind === kind ? [snapshot, ...current] : current;
            return current.map((project) => project.id === snapshot.id ? snapshot : project);
          });
          if (operationRef.current.status === "saving" && !pendingSaveRef.current) {
            transitionOperation({ type: "finish" });
          }
          if (saveTimer.current) break;
        } catch (cause) {
          if (operationRef.current.status === "transferring") return false;
          failedSaveRef.current = snapshot;
          if (!pendingSaveRef.current) pendingSaveRef.current = snapshot;
          transitionOperation({
            type: "fail",
            task: "save",
            projectId: snapshot.id,
            message: cause instanceof Error ? cause.message : "Could not save the project.",
          });
          return false;
        }
      }
      return true;
    })();
    saveInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (saveInFlightRef.current === task) saveInFlightRef.current = null;
    }
  }, [kind, transitionOperation]);

  const flushPendingSaves = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    while (saveInFlightRef.current) {
      if (!(await saveInFlightRef.current)) return false;
    }
    return pendingSaveRef.current ? runSaveQueue() : true;
  }, [runSaveQueue]);

  useEffect(() => {
    flushSavesRef.current = flushPendingSaves;
  }, [flushPendingSaves]);

  function scheduleProjectSave(project: ProjectRecord) {
    pendingSaveRef.current = project;
    transitionOperation({ type: "start", operation: { status: "saving", projectId: project.id } });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void runSaveQueue();
    }, 500);
  }

  function updateActiveProject(project: ProjectRecord) {
    if (blockingOperationRef.current && operationRef.current.status === "transferring") return;
    setError("");
    activeProjectRef.current = project;
    setActiveProject(project);
    scheduleProjectSave(project);
  }

  function updateCadScene(scene: CadSceneData) {
    const active = activeProjectRef.current;
    if (!active || active.kind !== "craft") return;
    updateActiveProject({ ...active, scene, updatedAt: currentTimestamp() });
  }

  function updateExperimentScene(scene: ExperimentSceneData) {
    const active = activeProjectRef.current;
    if (!active || active.kind !== "experiment") return;
    updateActiveProject({ ...active, scene, updatedAt: currentTimestamp() });
  }

  async function retrySave() {
    const project = activeProjectRef.current ?? failedSaveRef.current;
    if (!project || blockingOperationRef.current) return;
    pendingSaveRef.current = project;
    transitionOperation({ type: "start", operation: { status: "saving", projectId: project.id } });
    await flushPendingSaves();
  }

  async function closeEditor() {
    const project = activeProjectRef.current;
    if (!project || blockingOperationRef.current) return;
    blockingOperationRef.current = true;
    pendingSaveRef.current = project;
    transitionOperation({ type: "start", operation: { status: "saving", projectId: project.id } });
    try {
      if (!(await flushPendingSaves())) return;
      await refreshProjects();
      activeProjectRef.current = null;
      setActiveProject(null);
      transitionOperation({ type: "finish" });
    } catch (cause) {
      transitionOperation({
        type: "fail",
        task: "save",
        projectId: project.id,
        message: cause instanceof Error ? cause.message : "Could not save before closing the editor.",
      });
    } finally {
      blockingOperationRef.current = false;
    }
  }

  async function transferToExperiment(scene: CadSceneData) {
    const currentProject = activeProjectRef.current;
    if (!currentProject || currentProject.kind !== "craft") return;
    if (blockingOperationRef.current) throw new Error("Another project operation is already in progress.");
    blockingOperationRef.current = true;
    transitionOperation({
      type: "start",
      operation: { status: "transferring", projectId: currentProject.id },
    });
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const updatedCraft: ProjectRecord = { ...currentProject, scene, updatedAt: currentTimestamp() };
    pendingSaveRef.current = null;
    try {
      if (saveInFlightRef.current) await saveInFlightRef.current;
      pendingSaveRef.current = null;
      const experiment: ProjectRecord = {
        id: crypto.randomUUID(),
        title: `${currentProject.title} — Physics`.slice(0, 80),
        updatedAt: currentTimestamp(),
        kind: "experiment",
        scene: importCadScene(scene, () => crypto.randomUUID()),
      };
      await saveProjectsAtomically([updatedCraft, experiment]);
      setProjects((current) => current.map((project) =>
        project.id === updatedCraft.id ? updatedCraft : project,
      ));
      activeProjectRef.current = experiment;
      setActiveProject(experiment);
      transitionOperation({ type: "finish" });
    } catch (cause) {
      pendingSaveRef.current = updatedCraft;
      const message = cause instanceof Error ? cause.message : "Could not create an experiment from this design.";
      transitionOperation({
        type: "fail",
        task: "transfer",
        projectId: currentProject.id,
        message,
      });
      throw new Error(message, { cause });
    } finally {
      blockingOperationRef.current = false;
    }
  }

  async function removeProject(project: ProjectRecord) {
    if (blockingOperationRef.current || isOperationBusy) return;
    setError("");
    setNotice("");
    try {
      await deleteProject(project.id);
      await refreshProjects();
      setNotice(`“${project.title}” was deleted.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this project.");
    }
  }

  const activeProjectId = activeProject?.id;
  useEffect(() => {
    if (!activeProjectId) return;
    const handleNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target && link.target !== "_self" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (!pendingSaveRef.current && !saveInFlightRef.current && operationRef.current.status !== "saving") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void flushSavesRef.current()
        .then((saved) => {
          if (saved) window.location.assign(destination.href);
        })
        .catch((cause: unknown) => {
          transitionOperation({
            type: "fail",
            task: "save",
            projectId: activeProjectId,
            message: cause instanceof Error ? cause.message : "Could not save before navigating away.",
          });
        });
    };
    document.addEventListener("click", handleNavigation, true);
    return () => document.removeEventListener("click", handleNavigation, true);
  }, [activeProjectId, transitionOperation]);

  const operationError = operation.status === "error" ? operation.message : "";
  const editorError = error || operationError;
  const saveLabel = operation.status === "saving" &&
    operation.projectId === activeProject?.id
    ? "Saving changes locally…"
    : operation.status === "error" && operation.task === "save"
      ? "Save failed"
      : operation.status === "error" && operation.task === "transfer"
        ? "Transfer failed — retry"
      : operation.status === "transferring"
        ? "Preparing physics…"
        : "All changes saved locally";

  if (activeProject?.kind === "craft") {
    return (
      <CadEditor
        errorMessage={editorError}
        onClose={closeEditor}
        onRetrySave={retrySave}
        onSceneChange={updateCadScene}
        onTransfer={transferToExperiment}
        operation={operation}
        project={activeProject}
        saveLabel={saveLabel}
      />
    );
  }
  if (activeProject?.kind === "experiment") {
    return (
      <ExperimentEditor
        errorMessage={editorError}
        onClose={closeEditor}
        onRetrySave={retrySave}
        onSceneChange={updateExperimentScene}
        operation={operation}
        project={activeProject}
        saveLabel={saveLabel}
      />
    );
  }

  return (
    <main className={`page workspace-page ${accent}`}>
      <div className="workspace-breadcrumb">
        <AppLink href="/">← Overview</AppLink><span>/</span><span>{title}</span>
      </div>
      <section className="workspace-heading">
        <div>
          <span className="eyebrow">{kind === "craft" ? "DESIGN STUDIO" : "PHYSICS LAB"} · WORKSPACE 0{kind === "craft" ? "1" : "2"}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <span className={`workspace-emblem ${accent}`} aria-hidden="true">{kind === "craft" ? "◈" : "⌁"}</span>
      </section>

      <section className="workspace-content">
        <div className="workspace-intro panel">
          <span className="panel-kicker">YOUR WORKSPACE IS READY</span>
          <h2>{kind === "craft" ? "Start a new design." : "A good place to start."}</h2>
          <p>
            {kind === "craft"
              ? "Create a project to open the 3D editor. Your design stays in this browser."
              : "Projects are stored locally in this browser. Your experiments are not uploaded to a cloud service."}
          </p>
          <form className="create-project-form" onSubmit={createProject}>
            <label htmlFor="project-title">Project name</label>
            <div className="input-row">
              <input
                autoComplete="off"
                disabled={isOperationBusy}
                id="project-title"
                maxLength={80}
                onChange={(event) => setProjectTitle(event.target.value)}
                placeholder={kind === "craft" ? "e.g. Desk lamp assembly" : "e.g. Bouncing spheres"}
                value={projectTitle}
              />
              <button className="button button-primary" disabled={isOperationBusy} type="submit">
                {operation.status === "saving" ? "Saving…" : "Create project"} <span aria-hidden="true">＋</span>
              </button>
            </div>
          </form>
          {error && <p className="inline-error" role="alert">{error}</p>}
          {operation.status === "error" && operation.task === "save" && (
            <div className="operation-error" role="alert">
              <p>{operation.message}</p>
              <button className="text-button project-open-button" onClick={retrySave} type="button">Retry save</button>
            </div>
          )}
          {notice && <p className="inline-success" role="status">{notice}</p>}
        </div>

        <div aria-busy={isOperationBusy} className="workspace-projects panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">LOCAL LIBRARY</span>
              <h2>Your projects</h2>
            </div>
            <span className="project-count">{projects.length.toString().padStart(2, "0")}</span>
          </div>
          {loadWarnings.map((warning) => (
            <p className="inline-error" key={warning} role="alert">{warning}</p>
          ))}
          {operation.status === "loading" && operation.task === "library" ? (
            <p className="async-operation-status" role="status">Loading your local library…</p>
          ) : projects.length === 0 ? (
            <p className="muted-copy">
              {loadWarnings.length
                ? "No readable projects are available. The saved records above were left unchanged."
                : "No projects yet. Create one to save a starting point."}
            </p>
          ) : (
            <ul className="workspace-project-list">
              {projects.map((project) => (
                <li key={project.id}>
                  <span className={`project-kind ${kind}`} aria-hidden="true">{kind === "craft" ? "◈" : "⌁"}</span>
                  <span className="project-info"><strong>{project.title}</strong><span>Saved {new Date(project.updatedAt).toLocaleString()}</span></span>
                  <button
                    className="text-button project-open-button"
                    disabled={isOperationBusy}
                    onClick={() => openProject(project)}
                    type="button"
                  >
                    {operation.status === "loading" && operation.task === "load" &&
                    operation.projectId === project.id ? "Loading…" : "Open"}
                  </button>
                  {operation.status === "error" && operation.task === "load" &&
                    operation.projectId === project.id && (
                      <button className="text-button project-open-button" onClick={() => { void openProject(project); }} type="button">Retry</button>
                    )}
                  <button
                    aria-label={`Delete ${project.title}`}
                    className="text-button"
                    disabled={isOperationBusy}
                    onClick={() => removeProject(project)}
                    type="button"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          {operation.status === "loading" && operation.task === "load" && (
            <p className="async-operation-status" role="status">Loading and reconstructing the saved scene…</p>
          )}
          {operation.status !== "idle" && operation.status !== "error" && operation.status !== "loading" && (
            <p aria-live="polite" className="async-operation-status" role="status">
              {operation.status === "saving" ? "Saving project…" : "Transferring CAD model…"}
            </p>
          )}
          {operation.status === "error" && operation.task !== "save" && (
            <div className="operation-error" role="alert">
              <p>{operation.message}</p>
              {operation.task === "library" && (
                <button className="text-button project-open-button" onClick={retryLibraryLoad} type="button">Retry library load</button>
              )}
            </div>
          )}
        </div>
      </section>
      <p className="workspace-footnote"><span className="status-dot" /> {kind === "craft" ? "The CAD editor autosaves object geometry and transforms to your local library." : "Physics scenes and simulation state are saved to this device."}</p>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppLink } from "@/components/app-link";
import {
  deleteProject,
  getProject,
  listProjects,
  saveProject,
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

interface ProjectWorkspaceProps {
  kind: ProjectKind;
  title: string;
  description: string;
  accent: "violet" | "orange";
}

export function ProjectWorkspace({
  kind,
  title,
  description,
  accent,
}: ProjectWorkspaceProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [saveState, setSaveState] = useState("All changes saved locally");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshProjects = useCallback(async () => {
    const result = await listProjects(kind);
    setProjects(result.projects);
    setLoadWarnings(result.warnings);
  }, [kind]);

  useEffect(() => {
    let active = true;
    listProjects(kind)
      .then(({ projects: loadedProjects, warnings }) => {
        if (active) {
          setProjects(loadedProjects);
          setLoadWarnings(warnings);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load projects.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });

    return () => {
      active = false;
    };
  }, [kind]);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const cleanTitle = projectTitle.trim();
    if (!cleanTitle) {
      setError("Enter a project name before saving.");
      return;
    }

    const metadata = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      updatedAt: Date.now(),
    };
    const record: ProjectRecord = kind === "craft"
      ? { ...metadata, kind: "craft", scene: createEmptyCadScene() }
      : { ...metadata, kind: "experiment", scene: createEmptyExperimentScene() };

    try {
      await saveProject(record);
      setProjectTitle("");
      await refreshProjects();
      setActiveProject(record);
      setSaveState("All changes saved locally");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this project.");
    }
  }

  async function openProject(project: ProjectRecord) {
    setError("");
    setNotice("");
    try {
      const savedProject = await getProject(project.id);
      if (!savedProject || savedProject.kind !== kind) {
        throw new Error("This project is no longer available in the local library.");
      }
      setActiveProject(savedProject);
      setSaveState("All changes saved locally");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open this project.");
    }
  }

  function updateCadScene(scene: CadSceneData) {
    if (!activeProject || activeProject.kind !== "craft") return;
    setError("");
    const updatedProject = { ...activeProject, scene, updatedAt: Date.now() };
    setActiveProject(updatedProject);
    setSaveState("Saving changes locally…");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveProject(updatedProject)
        .then(() => {
          setProjects((current) => current.map((project) =>
            project.id === updatedProject.id ? updatedProject : project,
          ));
          setSaveState("All changes saved locally");
          saveTimer.current = null;
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not save the CAD scene.");
          setSaveState("Save failed");
        });
    }, 500);
  }

  function updateExperimentScene(scene: ExperimentSceneData) {
    if (!activeProject || activeProject.kind !== "experiment") return;
    setError("");
    const updatedProject = { ...activeProject, scene, updatedAt: Date.now() };
    setActiveProject(updatedProject);
    setSaveState("Saving changes locally…");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveProject(updatedProject)
        .then(() => {
          setProjects((current) => current.map((project) =>
            project.id === updatedProject.id ? updatedProject : project,
          ));
          setSaveState("All changes saved locally");
          saveTimer.current = null;
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not save the experiment scene.");
          setSaveState("Save failed");
        });
    }, 500);
  }

  async function closeEditor() {
    if (!activeProject) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await saveProject(activeProject);
      await refreshProjects();
      saveTimer.current = null;
      setActiveProject(null);
      setSaveState("All changes saved locally");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save before closing the editor.");
    }
  }

  async function transferToExperiment(scene: CadSceneData) {
    if (!activeProject || activeProject.kind !== "craft") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const updatedCraft = { ...activeProject, scene, updatedAt: Date.now() };
    const experiment: ProjectRecord = {
      id: crypto.randomUUID(),
      title: `${activeProject.title} — Physics`.slice(0, 80),
      updatedAt: Date.now(),
      kind: "experiment",
      scene: importCadScene(scene, () => crypto.randomUUID()),
    };
    try {
      await saveProject(updatedCraft);
      await saveProject(experiment);
      setProjects((current) => current.map((project) =>
        project.id === updatedCraft.id ? updatedCraft : project,
      ));
      setActiveProject(experiment);
      setSaveState("All changes saved locally");
      saveTimer.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create an experiment from this design.");
      setSaveState("Transfer failed");
      throw cause instanceof Error ? cause : new Error("Could not create an experiment from this design.");
    }
  }

  async function removeProject(project: ProjectRecord) {
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

  if (activeProject?.kind === "craft") {
    return (
      <CadEditor
        errorMessage={error}
        onClose={closeEditor}
        onSceneChange={updateCadScene}
        onTransfer={transferToExperiment}
        project={activeProject}
        saveLabel={saveState}
      />
    );
  }
  if (activeProject?.kind === "experiment") {
    return (
      <ExperimentEditor
        errorMessage={error}
        onClose={closeEditor}
        onSceneChange={updateExperimentScene}
        project={activeProject}
        saveLabel={saveState}
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
                id="project-title"
                maxLength={80}
                onChange={(event) => setProjectTitle(event.target.value)}
                placeholder={kind === "craft" ? "e.g. Desk lamp assembly" : "e.g. Bouncing spheres"}
                value={projectTitle}
              />
              <button className="button button-primary" type="submit">Create project <span aria-hidden="true">＋</span></button>
            </div>
          </form>
          {error && <p className="inline-error" role="alert">{error}</p>}
          {notice && <p className="inline-success" role="status">{notice}</p>}
        </div>

        <div className="workspace-projects panel">
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
          {busy ? (
            <p className="muted-copy">Opening your local library…</p>
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
                  <button className="text-button project-open-button" onClick={() => openProject(project)} type="button">Open</button>
                  <button className="text-button" onClick={() => removeProject(project)} type="button" aria-label={`Delete ${project.title}`}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <p className="workspace-footnote"><span className="status-dot" /> {kind === "craft" ? "The CAD editor autosaves object geometry and transforms to your local library." : "Physics scenes and simulation state are saved to this device."}</p>
    </main>
  );
}

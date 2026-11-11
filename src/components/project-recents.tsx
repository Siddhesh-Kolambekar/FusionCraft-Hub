"use client";

import { useEffect, useState } from "react";
import { listProjects, type ProjectRecord } from "@/lib/projects";
import { AppLink } from "@/components/app-link";

export function ProjectRecents() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    listProjects()
      .then((result) => {
        setProjects(result.projects);
        setWarnings(result.warnings);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load projects."));
  }, []);

  if (error) return <p className="inline-error" role="alert">{error}</p>;
  if (projects.length === 0) {
    return (
      <>
        {warnings.map((warning) => <p className="inline-error" key={warning} role="alert">{warning}</p>)}
        <div className="empty-projects">
          <span className="empty-icon" aria-hidden="true">＋</span>
          <p>Your next idea starts in one of the workspaces above.</p>
        </div>
      </>
    );
  }

  return (
    <>
      {warnings.map((warning) => <p className="inline-error" key={warning} role="alert">{warning}</p>)}
      <div className="project-list">
        {projects.slice(0, 4).map((project) => (
          <AppLink className="project-row" href={project.kind === "craft" ? "/craft/" : "/experiment/"} key={project.id}>
            <span className={`project-kind ${project.kind}`} aria-hidden="true">{project.kind === "craft" ? "◈" : "⌁"}</span>
            <span className="project-info">
              <strong>{project.title}</strong>
              <span>{project.kind === "craft" ? "Craft & Assemble" : "Experiment & Simulate"}</span>
            </span>
            <time dateTime={new Date(project.updatedAt).toISOString()}>
              {new Date(project.updatedAt).toLocaleDateString()}
            </time>
            <span className="row-arrow" aria-hidden="true">↗</span>
          </AppLink>
        ))}
      </div>
    </>
  );
}

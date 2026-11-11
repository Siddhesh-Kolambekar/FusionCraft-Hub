"use client";

import { useCallback, useRef, useState } from "react";
import {
  addExperimentBody,
  type ExperimentObject,
  type ExperimentSceneData,
} from "@/lib/experiment-model";
import type { Vector3Tuple } from "@/lib/cad-model";
import type { ExperimentProjectRecord } from "@/lib/projects";
import { PhysicsViewport } from "@/components/physics-viewport";

interface ExperimentEditorProps {
  project: ExperimentProjectRecord;
  saveLabel: string;
  errorMessage: string;
  onSceneChange: (scene: ExperimentSceneData) => void;
  onClose: () => void;
}

function VectorProperty({
  label,
  value,
  onChange,
  min,
  step = 0.1,
  disabled = false,
}: {
  label: string;
  value: Vector3Tuple;
  onChange: (value: Vector3Tuple) => void;
  min?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <fieldset className="cad-vector-property">
      <legend>{label}</legend>
      <div>
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <label key={axis}>
            <span>{axis}</span>
            <input
              aria-label={`${label} ${axis}`}
              disabled={disabled}
              min={min}
              onChange={(event) => {
                const next = [...value] as Vector3Tuple;
                const entered = Number(event.target.value);
                if (!Number.isFinite(entered) || (min !== undefined && entered < min)) return;
                next[index] = entered;
                onChange(next);
              }}
              step={step}
              type="number"
              value={value[index]}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BodyProperties({
  object,
  onChange,
  disabled,
}: {
  object: ExperimentObject;
  onChange: (change: Partial<ExperimentObject>) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label className="cad-property">
        <span>Name</span>
        <input
          aria-label="Body name"
          disabled={disabled}
          maxLength={80}
          onChange={(event) => onChange({ name: event.target.value })}
          value={object.name}
        />
      </label>
      <label className="cad-property">
        <span>Body type</span>
        <select
          aria-label="Body type"
          disabled={disabled}
          onChange={(event) => onChange({
            bodyType: event.target.value === "fixed" ? "fixed" : "dynamic",
          })}
          value={object.bodyType}
        >
          <option value="dynamic">Dynamic</option>
          <option value="fixed">Fixed</option>
        </select>
      </label>
      {object.bodyType === "dynamic" && (
        <label className="cad-property">
          <span>Mass</span>
          <input
            aria-label="Body mass"
            disabled={disabled}
            min={0.01}
            onChange={(event) => {
              const mass = Number(event.target.value);
              if (Number.isFinite(mass) && mass >= 0.01) onChange({ mass });
            }}
            step={0.1}
            type="number"
            value={object.mass}
          />
        </label>
      )}
      <label className="cad-property cad-color-property">
        <span>Material color</span>
        <input
          aria-label="Body color"
          disabled={disabled}
          onChange={(event) => onChange({ color: event.target.value })}
          type="color"
          value={object.color}
        />
      </label>
      <VectorProperty disabled={disabled} label="Position" value={object.position} onChange={(position) => onChange({ position })} />
      <VectorProperty disabled={disabled} label="Rotation" value={object.rotation} onChange={(rotation) => onChange({ rotation })} />
      <VectorProperty disabled={disabled} label="Scale" value={object.scale} min={0.01} step={0.1} onChange={(scale) => onChange({ scale })} />
    </>
  );
}

export function ExperimentEditor({
  project,
  saveLabel,
  errorMessage,
  onSceneChange,
  onClose,
}: ExperimentEditorProps) {
  const scene = project.scene;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [capturingResult, setCapturingResult] = useState(false);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [error, setError] = useState("");
  const initialScene = useRef(scene);
  const selectedObject = scene.objects.find((object) => object.id === selectedId);

  const updateScene = useCallback((nextScene: ExperimentSceneData) => {
    setError("");
    setPhysicsReady(false);
    onSceneChange(nextScene);
  }, [onSceneChange]);

  const handleSimulationStop = useCallback((nextScene: ExperimentSceneData) => {
    updateScene(nextScene);
    setCapturingResult(false);
  }, [updateScene]);

  function addBody(type: ExperimentObject["type"]) {
    const { scene: nextScene, object } = addExperimentBody(scene, type, crypto.randomUUID());
    setSelectedId(object.id);
    updateScene(nextScene);
  }

  function updateObject(id: string, change: Partial<ExperimentObject>) {
    updateScene({
      ...scene,
      objects: scene.objects.map((object) => object.id === id ? { ...object, ...change } : object),
    });
  }

  function removeSelected() {
    if (!selectedId) return;
    updateScene({ ...scene, objects: scene.objects.filter((object) => object.id !== selectedId) });
    setSelectedId(null);
  }

  function startSimulation() {
    initialScene.current = scene;
    setRunning(true);
  }

  function stopSimulation() {
    setCapturingResult(true);
    setRunning(false);
  }

  function resetSimulation() {
    setRunning(false);
    updateScene(initialScene.current);
  }

  return (
    <main className="cad-page">
      <header className="cad-project-header">
        <button className="cad-back-button" disabled={running || capturingResult} onClick={onClose} type="button">← Projects</button>
        <div className="cad-project-title">
          <span className="eyebrow">EXPERIMENT &amp; SIMULATE / PHYSICS</span>
          <h1>{project.title}</h1>
        </div>
        <span className="cad-save-label"><span className="status-dot" />{saveLabel}</span>
      </header>

      <section aria-label="Physics experiment editor" className="cad-shell">
        <div className="cad-toolbar">
          <div aria-label="Add body" className="cad-tool-group">
            <span className="cad-tool-caption">ADD BODY</span>
            {(["box", "sphere", "cylinder"] as const).map((type) => (
              <button
                className="cad-tool-button"
                disabled={running}
                key={type}
                onClick={() => addBody(type)}
                type="button"
              >
                ＋ {type[0].toUpperCase()}{type.slice(1)}
              </button>
            ))}
          </div>
          <div className="cad-tool-group">
            <span className="cad-tool-caption">SIMULATION</span>
            {running ? (
              <button className="cad-tool-button destructive" onClick={stopSimulation} type="button">Stop &amp; save state</button>
            ) : (
              <button className="cad-tool-button selected" disabled={!physicsReady} onClick={startSimulation} type="button">Run simulation</button>
            )}
            <button className="cad-tool-button" disabled={running || !scene.objects.length} onClick={resetSimulation} type="button">Reset</button>
            <span aria-live="polite" className="cad-tool-caption">{physicsReady ? "RAPIER READY" : "INITIALIZING…"}</span>
          </div>
          <div className="cad-tool-group">
            <span className="cad-tool-caption">SCENE</span>
            <VectorProperty
              disabled={running}
              label="Gravity"
              value={scene.gravity}
              onChange={(gravity) => updateScene({ ...scene, gravity })}
              step={0.1}
            />
          </div>
        </div>

        <div className="cad-work-area">
          <aside className="cad-panel cad-tree-panel">
            <div className="cad-panel-heading">
              <div><span className="panel-kicker">MODEL TREE</span><h2>Bodies</h2></div>
              <span className="cad-count">{scene.objects.length.toString().padStart(2, "0")}</span>
            </div>
            <div className="cad-tree-list">
              {scene.objects.length === 0 ? (
                <p className="cad-tree-empty">Add a primitive or import a CAD design to start the scene.</p>
              ) : scene.objects.map((object) => (
                <div
                  className={selectedId === object.id ? "cad-tree-row active" : "cad-tree-row"}
                  key={object.id}
                >
                  <button className="cad-tree-name" onClick={() => setSelectedId(object.id)} type="button">
                    <span className={`tree-object-icon ${object.type}`} aria-hidden="true">
                      {object.type === "sphere" ? "●" : object.type === "cylinder" ? "⬭" : "▧"}
                    </span>
                    <span>{object.name}</span>
                  </button>
                  <span className="cad-tool-caption">{object.bodyType === "dynamic" ? "DYN" : "FIX"}</span>
                </div>
              ))}
            </div>
          </aside>

          <div className="cad-viewport-panel">
            <div className="cad-viewport-topline"><span>3D PHYSICS VIEWPORT</span><span>Orbit · pan · zoom</span></div>
            <PhysicsViewport
              onError={setError}
              onReady={() => setPhysicsReady(true)}
              onSelect={setSelectedId}
              onSimulationStop={handleSimulationStop}
              running={running}
              sceneData={scene}
            />
            {(error || errorMessage) && (
              <div className="cad-viewport-error" role="alert">{error || errorMessage}</div>
            )}
            <div className="cad-viewport-hint">Add bodies, set fixed/dynamic behavior, and run the local Rapier simulation.</div>
          </div>

          <aside className="cad-panel cad-inspector">
            <div className="cad-panel-heading">
              <div><span className="panel-kicker">INSPECTOR</span><h2>Properties</h2></div>
            </div>
            {selectedObject ? (
              <>
                <div className="cad-selection-kind"><span className="selection-mark" />{selectedObject.type} body</div>
                <BodyProperties
                  disabled={running}
                  object={selectedObject}
                  onChange={(change) => updateObject(selectedObject.id, change)}
                />
                <button className="cad-visibility-wide destructive" disabled={running} onClick={removeSelected} type="button">Delete body</button>
              </>
            ) : (
              <p className="cad-inspector-empty">Select a body in the tree or viewport to inspect its physics properties.</p>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

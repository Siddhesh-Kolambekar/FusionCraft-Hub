"use client";

import { useState } from "react";
import {
  addCadPrimitive,
  createCadAssembly,
  dissolveCadAssembly,
  type CadObject,
  type CadPrimitiveType,
  type CadSceneData,
  type Vector3Tuple,
} from "@/lib/cad-model";
import type { CraftProjectRecord } from "@/lib/projects";
import {
  SceneViewport,
  type CadSelection,
  type TransformMode,
} from "@/components/scene-viewport";

interface CadEditorProps {
  project: CraftProjectRecord;
  saveLabel: string;
  errorMessage: string;
  onSceneChange: (scene: CadSceneData) => void;
  onTransfer: (scene: CadSceneData) => Promise<void>;
  onClose: () => void;
}

function ObjectProperties({
  object,
  onChange,
}: {
  object: CadObject;
  onChange: (change: Partial<CadObject>) => void;
}) {
  return (
    <>
      <label className="cad-property">
        <span>Name</span>
        <input aria-label="Object name" maxLength={80} onChange={(event) => onChange({ name: event.target.value })} value={object.name} />
      </label>
      <label className="cad-property cad-color-property">
        <span>Material color</span>
        <input aria-label="Material color" onChange={(event) => onChange({ color: event.target.value })} type="color" value={object.color} />
      </label>
      <VectorProperty label="Position" value={object.position} onChange={(position) => onChange({ position })} />
      <VectorProperty label="Rotation" value={object.rotation} degrees onChange={(rotation) => onChange({ rotation })} />
      <VectorProperty label="Scale" value={object.scale} min={0.01} step={0.1} onChange={(scale) => onChange({ scale })} />
    </>
  );
}

function GroupProperties({
  group,
  onChange,
}: {
  group: NonNullable<CadSceneData["groups"][number]>;
  onChange: (change: Partial<typeof group>) => void;
}) {
  return (
    <>
      <label className="cad-property">
        <span>Assembly name</span>
        <input aria-label="Assembly name" maxLength={80} onChange={(event) => onChange({ name: event.target.value })} value={group.name} />
      </label>
      <VectorProperty label="Position" value={group.position} onChange={(position) => onChange({ position })} />
      <VectorProperty label="Rotation" value={group.rotation} degrees onChange={(rotation) => onChange({ rotation })} />
      <VectorProperty label="Scale" value={group.scale} min={0.01} step={0.1} onChange={(scale) => onChange({ scale })} />
    </>
  );
}

function VectorProperty({
  label,
  value,
  degrees = false,
  min,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: Vector3Tuple;
  degrees?: boolean;
  min?: number;
  step?: number;
  onChange: (value: Vector3Tuple) => void;
}) {
  const axisLabels = ["X", "Y", "Z"];
  return (
    <fieldset className="cad-vector-property">
      <legend>{label}{degrees ? " (°)" : ""}</legend>
      <div>
        {axisLabels.map((axis, index) => {
          const shownValue = degrees ? Number((value[index] * 180 / Math.PI).toFixed(2)) : value[index];
          return (
            <label key={axis}>
              <span>{axis}</span>
              <input
                aria-label={`${label} ${axis}`}
                min={min}
                onChange={(event) => {
                  const next = [...value] as Vector3Tuple;
                  const entered = Number(event.target.value);
                  next[index] = degrees ? entered * Math.PI / 180 : entered;
                  onChange(next);
                }}
                step={step}
                type="number"
                value={shownValue}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CadEditor({
  project,
  saveLabel,
  errorMessage,
  onSceneChange,
  onTransfer,
  onClose,
}: CadEditorProps) {
  const [selection, setSelection] = useState<CadSelection>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<TransformMode>("select");
  const [viewError, setViewError] = useState("");
  const [message, setMessage] = useState("");
  const [transferring, setTransferring] = useState(false);
  const scene = project.scene;
  const selectedObject = selection?.kind === "object"
    ? scene.objects.find((object) => object.id === selection.id)
    : undefined;
  const selectedGroup = selection?.kind === "group"
    ? scene.groups.find((group) => group.id === selection.id)
    : undefined;
  const groupedObjectIds = new Set(scene.objects.filter((object) => object.groupId).map((object) => object.id));
  const canGroup = selectedIds.length >= 2 && selectedIds.every((id) => !groupedObjectIds.has(id));

  function commit(nextScene: CadSceneData) {
    setMessage("");
    onSceneChange(nextScene);
  }

  async function transferToExperiment() {
    if (transferring) return;
    setMessage("");
    setTransferring(true);
    try {
      await onTransfer(scene);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create an experiment from this design.");
      setTransferring(false);
    }
  }

  function addPrimitive(type: CadPrimitiveType) {
    const { scene: nextScene, object } = addCadPrimitive(scene, type, crypto.randomUUID());
    setSelection({ kind: "object", id: object.id });
    setSelectedIds([object.id]);
    setMode("translate");
    commit(nextScene);
  }

  function updateObject(id: string, change: Partial<CadObject>) {
    commit({
      ...scene,
      objects: scene.objects.map((object) => object.id === id ? { ...object, ...change } : object),
    });
  }

  function updateGroup(id: string, change: Partial<CadSceneData["groups"][number]>) {
    commit({
      ...scene,
      groups: scene.groups.map((group) => group.id === id ? { ...group, ...change } : group),
    });
  }

  function toggleObjectVisibility(object: CadObject) {
    updateObject(object.id, { visible: !object.visible });
  }

  function toggleGroupVisibility(groupId: string) {
    const group = scene.groups.find((candidate) => candidate.id === groupId);
    if (group) updateGroup(group.id, { visible: !group.visible });
  }

  function toggleAssemblySelection(object: CadObject, checked: boolean) {
    setSelectedIds((ids) =>
      checked ? [...new Set([...ids, object.id])] : ids.filter((id) => id !== object.id),
    );
    setSelection({ kind: "object", id: object.id });
  }

  function createAssembly() {
    try {
      const nextScene = createCadAssembly(scene, selectedIds, crypto.randomUUID());
      const group = nextScene.groups[nextScene.groups.length - 1];
      setSelectedIds([]);
      setSelection({ kind: "group", id: group.id });
      setMode("translate");
      commit(nextScene);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the assembly.");
    }
  }

  function duplicateSelection() {
    if (!selection) return;
    if (selection.kind === "object") {
      const object = scene.objects.find((candidate) => candidate.id === selection.id);
      if (!object) return;
      const copy: CadObject = {
        ...object,
        id: crypto.randomUUID(),
        name: `${object.name} copy`,
        position: [object.position[0] + 1, object.position[1], object.position[2]],
      };
      setSelection({ kind: "object", id: copy.id });
      setSelectedIds([copy.id]);
      commit({ ...scene, objects: [...scene.objects, copy] });
      return;
    }

    const group = scene.groups.find((candidate) => candidate.id === selection.id);
    if (!group) return;
    const copyId = crypto.randomUUID();
    const copyGroup = {
      ...group,
      id: copyId,
      name: `${group.name} copy`,
      position: [group.position[0] + 1, group.position[1], group.position[2]] as Vector3Tuple,
    };
    const copies = scene.objects
      .filter((object) => object.groupId === group.id)
      .map((object) => ({ ...object, id: crypto.randomUUID(), groupId: copyId }));
    setSelection({ kind: "group", id: copyId });
    commit({
      ...scene,
      groups: [...scene.groups, copyGroup],
      objects: [...scene.objects, ...copies],
    });
  }

  function deleteSelection() {
    if (!selection) return;
    if (selection.kind === "group") {
      const deletedObjectIds = new Set(
        scene.objects.filter((object) => object.groupId === selection.id).map((object) => object.id),
      );
      setSelection(null);
      setSelectedIds((ids) => ids.filter((id) => !deletedObjectIds.has(id)));
      commit({
        ...scene,
        groups: scene.groups.filter((group) => group.id !== selection.id),
        objects: scene.objects.filter((object) => object.groupId !== selection.id),
      });
      return;
    }

    const object = scene.objects.find((candidate) => candidate.id === selection.id);
    if (!object) return;
    const remainingObjects = scene.objects.filter((candidate) => candidate.id !== object.id);
    const remainingGroupIds = new Set(remainingObjects.map((candidate) => candidate.groupId).filter(Boolean));
    setSelection(null);
    setSelectedIds((ids) => ids.filter((id) => id !== object.id));
    commit({
      ...scene,
      objects: remainingObjects,
      groups: scene.groups.filter((group) => remainingGroupIds.has(group.id)),
    });
  }

  function ungroupSelection() {
    if (selection?.kind !== "group") return;
    try {
      const group = scene.groups.find((candidate) => candidate.id === selection.id);
      const firstPart = scene.objects.find((object) => object.groupId === selection.id);
      const nextScene = dissolveCadAssembly(scene, selection.id);
      setSelection(firstPart ? { kind: "object", id: firstPart.id } : null);
      setSelectedIds([]);
      commit(nextScene);
      if (!group) setMessage("Assembly was removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not ungroup the assembly.");
    }
  }

  return (
    <main className="cad-page">
      <header className="cad-project-header">
        <button className="cad-back-button" onClick={onClose} type="button">← Projects</button>
        <div className="cad-project-title">
          <span className="eyebrow">CRAFT &amp; ASSEMBLE / DESIGN</span>
          <h1>{project.title}</h1>
        </div>
        <button className="cad-back-button" disabled={transferring} onClick={transferToExperiment} type="button">
          {transferring ? "Preparing physics…" : "Open in physics lab"}
        </button>
        <span className="cad-save-label"><span className="status-dot" />{saveLabel}</span>
      </header>

      <section className="cad-shell" aria-label="CAD editor">
        <div className="cad-toolbar">
          <div className="cad-tool-group" aria-label="Add primitive">
            <span className="cad-tool-caption">ADD</span>
            <button className="cad-tool-button" onClick={() => addPrimitive("box")} type="button" title="Add box">＋ Box</button>
            <button className="cad-tool-button" onClick={() => addPrimitive("sphere")} type="button" title="Add sphere">＋ Sphere</button>
            <button className="cad-tool-button" onClick={() => addPrimitive("cylinder")} type="button" title="Add cylinder">＋ Cylinder</button>
          </div>
          <div className="cad-tool-group" aria-label="Transform mode">
            <span className="cad-tool-caption">TRANSFORM</span>
            {([
              ["select", "Select"],
              ["translate", "Move"],
              ["rotate", "Rotate"],
              ["scale", "Scale"],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={mode === value}
                className={mode === value ? "cad-tool-button selected" : "cad-tool-button"}
                key={value}
                onClick={() => setMode(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="cad-tool-group cad-action-group">
            <span className="cad-tool-caption">ASSEMBLE</span>
            <button className="cad-tool-button" disabled={!canGroup} onClick={createAssembly} type="button">Group selected</button>
            <button className="cad-tool-button" disabled={selection?.kind !== "group"} onClick={ungroupSelection} type="button">Ungroup</button>
            <button className="cad-tool-button" disabled={!selection} onClick={duplicateSelection} type="button">Duplicate</button>
            <button className="cad-tool-button destructive" disabled={!selection} onClick={deleteSelection} type="button">Delete</button>
          </div>
        </div>

        {(errorMessage || message) && <p className="cad-message" role="alert">{errorMessage || message}</p>}
        <div className="cad-work-area">
          <aside className="cad-panel cad-tree-panel">
            <div className="cad-panel-heading">
              <div><span className="panel-kicker">MODEL TREE</span><h2>Components</h2></div>
              <span className="cad-count">{scene.objects.length.toString().padStart(2, "0")}</span>
            </div>
            <div className="cad-tree-list">
              {scene.groups.map((group) => (
                <div className="cad-tree-group" key={group.id}>
                  <div className={selection?.kind === "group" && selection.id === group.id ? "cad-tree-row active" : "cad-tree-row"}>
                    <button className="cad-tree-name" onClick={() => setSelection({ kind: "group", id: group.id })} type="button">
                      <span className="tree-group-icon" aria-hidden="true">▱</span>{group.name}
                    </button>
                    <button aria-label={`${group.visible ? "Hide" : "Show"} ${group.name}`} className="cad-visibility" onClick={() => toggleGroupVisibility(group.id)} type="button">{group.visible ? "◉" : "○"}</button>
                  </div>
                  {scene.objects.filter((object) => object.groupId === group.id).map((object) => (
                    <ObjectTreeRow
                      checked={selectedIds.includes(object.id)}
                      depth={1}
                      key={object.id}
                      object={object}
                      selected={selection?.kind === "object" && selection.id === object.id}
                      onCheck={(checked) => toggleAssemblySelection(object, checked)}
                      onSelect={() => setSelection({ kind: "object", id: object.id })}
                      onToggleVisibility={() => toggleObjectVisibility(object)}
                    />
                  ))}
                </div>
              ))}
              {scene.objects.filter((object) => !object.groupId).map((object) => (
                <ObjectTreeRow
                  checked={selectedIds.includes(object.id)}
                  depth={0}
                  key={object.id}
                  object={object}
                  selected={selection?.kind === "object" && selection.id === object.id}
                  onCheck={(checked) => toggleAssemblySelection(object, checked)}
                  onSelect={() => setSelection({ kind: "object", id: object.id })}
                  onToggleVisibility={() => toggleObjectVisibility(object)}
                />
              ))}
              {scene.objects.length === 0 && <p className="cad-tree-empty">Add a primitive to begin your model.</p>}
            </div>
            <p className="cad-tree-hint">Check multiple loose components, then group them into an assembly.</p>
          </aside>

          <section className="cad-viewport-panel">
            <div className="cad-viewport-topline"><span>3D VIEWPORT</span><span>Orbit · pan · zoom</span></div>
            <SceneViewport
              mode={mode}
              onError={setViewError}
              onSceneChange={commit}
              onSelect={setSelection}
              sceneData={scene}
              selection={selection}
            />
            {viewError && <p className="cad-viewport-error" role="alert">{viewError}</p>}
            <div className="cad-viewport-hint">Drag the gizmo to transform · Right-drag to pan · Scroll to zoom</div>
          </section>

          <aside className="cad-panel cad-inspector">
            <div className="cad-panel-heading">
              <div><span className="panel-kicker">INSPECTOR</span><h2>Properties</h2></div>
            </div>
            {selectedObject ? (
              <>
                <div className="cad-selection-kind"><span className="selection-mark" /> {selectedObject.type}</div>
                <ObjectProperties object={selectedObject} onChange={(change) => updateObject(selectedObject.id, change)} />
                <button className="cad-visibility-wide" onClick={() => toggleObjectVisibility(selectedObject)} type="button">
                  {selectedObject.visible ? "Hide component" : "Show component"}
                </button>
              </>
            ) : selectedGroup ? (
              <>
                <div className="cad-selection-kind"><span className="selection-mark group-mark" /> Assembly · {scene.objects.filter((object) => object.groupId === selectedGroup.id).length} components</div>
                <GroupProperties group={selectedGroup} onChange={(change) => updateGroup(selectedGroup.id, change)} />
                <button className="cad-visibility-wide" onClick={() => toggleGroupVisibility(selectedGroup.id)} type="button">
                  {selectedGroup.visible ? "Hide assembly" : "Show assembly"}
                </button>
              </>
            ) : (
              <p className="cad-inspector-empty">Select a component or assembly to inspect its properties.</p>
            )}
          </aside>
        </div>
        {message && <p className="cad-message" role="status">{message}</p>}
      </section>
    </main>
  );
}

function ObjectTreeRow({
  object,
  depth,
  selected,
  checked,
  onCheck,
  onSelect,
  onToggleVisibility,
}: {
  object: CadObject;
  depth: 0 | 1;
  selected: boolean;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onSelect: () => void;
  onToggleVisibility: () => void;
}) {
  return (
    <div className={selected ? `cad-tree-row active depth-${depth}` : `cad-tree-row depth-${depth}`}>
      <input
        aria-label={`Select ${object.name} for assembly`}
        checked={checked}
        onChange={(event) => onCheck(event.target.checked)}
        type="checkbox"
      />
      <button className="cad-tree-name" onClick={onSelect} type="button">
        <span className={`tree-object-icon ${object.type}`} aria-hidden="true">{object.type === "box" ? "▧" : object.type === "sphere" ? "●" : "⬭"}</span>
        <span>{object.name}</span>
      </button>
      <button aria-label={`${object.visible ? "Hide" : "Show"} ${object.name}`} className="cad-visibility" onClick={onToggleVisibility} type="button">{object.visible ? "◉" : "○"}</button>
    </div>
  );
}

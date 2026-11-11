import { ProjectWorkspace } from "@/components/project-workspace";

export default function ExperimentPage() {
  return (
    <ProjectWorkspace
      kind="experiment"
      title="Experiment & Simulate"
      description="Set up a scene and get ready to test what happens when the rules take over."
      accent="orange"
    />
  );
}

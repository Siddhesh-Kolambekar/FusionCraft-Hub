import { AppLink } from "@/components/app-link";
import { ProjectRecents } from "@/components/project-recents";

export default function HomePage() {
  return (
    <main className="page dashboard">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">YOUR LOCAL CREATIVE WORKBENCH</span>
          <h1>Make it. Build it. Find out what happens.</h1>
          <p>
            Design precise components, bring them into a simulation, and keep
            every project on your device.
          </p>
          <div className="hero-actions">
            <AppLink className="button button-primary" href="/craft/">
              Open Craft &amp; Assemble <span aria-hidden="true">↗</span>
            </AppLink>
            <AppLink className="button button-secondary" href="/experiment/">
              Start an experiment
            </AppLink>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orb orb-main" />
          <div className="orb orb-small" />
          <div className="art-label">IDEAS IN MOTION</div>
        </div>
      </section>

      <section className="workspace-grid" aria-label="Workspaces">
        <AppLink className="workspace-card craft-card" href="/craft/">
          <span className="card-index">01 / DESIGN</span>
          <span className="card-icon" aria-hidden="true">◈</span>
          <h2>Craft &amp; Assemble</h2>
          <p>Shape components and put your ideas together in 3D.</p>
          <span className="card-link">Enter workspace <span aria-hidden="true">→</span></span>
        </AppLink>
        <AppLink className="workspace-card experiment-card" href="/experiment/">
          <span className="card-index">02 / EXPERIMENT</span>
          <span className="card-icon" aria-hidden="true">⌁</span>
          <h2>Experiment &amp; Simulate</h2>
          <p>Build a scene, set the rules, and see what physics does.</p>
          <span className="card-link">Enter workspace <span aria-hidden="true">→</span></span>
        </AppLink>
      </section>

      <section className="dashboard-bottom">
        <div className="section-heading">
          <div>
            <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
            <h2>Recent projects</h2>
          </div>
          <span className="local-note"><span className="status-dot" /> Stored on this device</span>
        </div>
        <ProjectRecents />
      </section>
    </main>
  );
}

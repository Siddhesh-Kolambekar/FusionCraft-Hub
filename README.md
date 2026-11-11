# FusionCraft Hub

FusionCraft Hub is a local-first workspace with separate environments for 3D design and physics experiments. Project records are stored in the browser's IndexedDB; they are not sent to a cloud database.

## Getting started

Use Node.js 20.9 or newer:

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. The dashboard links to **Craft & Assemble** and **Experiment & Simulate**. Each workspace can create and manage project records stored on the current device.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```

The production build exports static files into `out/`. Serve that directory from an HTTPS host at the domain root to enable the root-scoped service worker; this configuration is not set up for subpath hosting. Visit both workspaces and open the physics editor while online once so their JavaScript and physics runtime assets enter the offline cache. Local projects remain in the browser's IndexedDB and are not included in the exported files.

### Static deployment (Cloudflare Pages)

Cloudflare Pages can host this export without an application server, database, or authentication:

1. Connect the GitHub repository to a new **Pages** project.
2. Set the build command to `npm run build` and the build output directory to `out`. No framework adapter, environment variables, or backend functions are required.
3. Use the provided `*.pages.dev` HTTPS address for root-path hosting, or attach a domain that serves the site at `/`. Do not deploy this configuration under a URL subpath: routes and the service worker are root-scoped.
4. Open the deployed site online, visit both workspaces, and open the physics editor once to warm the offline cache. Then verify offline behavior in the target browser.

Deployment is not performed by these instructions. Projects stay in IndexedDB for the specific browser origin and device; moving to a hosted origin does not migrate projects from localhost or another origin.

## Current scope

The Craft & Assemble workspace includes a Three.js editor with box, sphere, and cylinder creation; selection, visibility, color and transform controls; basic component grouping; and IndexedDB scene autosave/reopen. Experiment projects support editable 3D bodies, gravity, mass and fixed/dynamic behavior, and local Rapier simulation with saved results. A CAD design can be transferred into a new physics project. Offline route caching and recovery from unsupported saved scenes are implemented; independent acceptance results and remaining deployment risks are recorded in `DEVELOPMENT_LOG.md`.

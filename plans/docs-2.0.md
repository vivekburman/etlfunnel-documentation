# Docs 2.0

Status: **all eight sections, the theme, redirects and the sidebar done 2026-10-28. Not viewed in a browser; not committed.**

Plans live in `plans/` at the repo root, outside `docs/`, so Docusaurus does not publish them. The code repo (`etlfunnel`) and the engine repo (`etlfunnel-execution`) are read-only: docs are checked against them, never the other way round.

## Why

- The sidebar groups pages by implementation (Data Plane, Control Plane, Executions), not by how a person works.
- The delivery pages describe the design that `etlfunnel/docs/plans/package-flow.md` replaced on 2026-10-27 (Release stage, stage requests, approved hub changes). Thirteen lines still use those terms.
- The theme is 43 lines of CSS and the default Docusaurus homepage. `design-concepts/connectors-section.html` has a dark glass look that was never used.
- Not yet checked against the docs: workspace scope (workspaces and a group in each), the Flow Graph view.

## Decisions

1. **Story order, reader first.** Each section answers the question the reader has at that point.
2. **Every page is verified against code** before it is written: UI labels from `web/src`, behaviour from `service/`, rules from the plans, connector shapes from `etlfunnel-execution`. Anything the code does not do is not documented.
3. **Technical depth from the user's side:** what you see, what you can configure, what happens when it fails, and the limits. Not internal structure.
4. **Theme follows etlfunnel.com** (revised 2026-10-28): light warm-grey page, Manrope, floating pill navbar with a dark CTA, pill-style cards and tables, orange for buttons, links and accents only; a warm dark mode stays for the toggle. There is no custom landing page: the docs are opened onto an inner page, so `/` redirects to `/intro`.
5. **Old URLs:** Docusaurus redirects for every moved or renamed page, so links from the website do not break.

## Story

| # | Section | Question it answers | Pages (new or rewritten in bold) |
|---|---|---|---|
| 1 | Start here | What is this and does it fit me? | **intro**, architecture (server and runners), **quickstart**, setup-guide, runner |
| 2 | Build | How do I define a pipeline? | connector-hub, resource-flow, resource-collection, **flow graph view**, transformer-hook, user-libraries, connector-entity, **connector catalog** |
| 3 | Shape how it runs | How do I control delivery, stopping and failure? | orchestrator, fixture, destination-write-tune, termination-rule, checkpoint, backlog |
| 4 | Run and watch | How do I run it and see what happened? | creating-a-new-build, schedules, running-while-you-develop, ef-codes |
| 5 | Work as a team | How do several people change it safely? | **workspaces**, roles-and-permissions, drafts-and-change-sets, **review**, notifications |
| 6 | Ship it | How does a change reach production? | **delivery-overview**, packages, **stages**, **sign-off**, **production schedules**, rolling-back |
| 7 | Automate | How do I connect it to everything else? | integration-webhook, mcp |
| 8 | Connector reference | What are the exact settings for X? | existing per-connector pages, one shared template |

## Order of work

1. Plan (this file).
2. Theme foundation: `custom.css`, landing page, navbar and footer. Built, not served (no dev server unless asked).
3. Section 6 Ship it, because it is the most wrong today.
4. Section 5, then 1, 2, 3, 4, 7, 8.
5. New sidebar, redirects, `onBrokenLinks: throw` build passing.

Per page: read the code, write, note the files checked at the foot of this plan.

## Verification log

### Section 6, Ship it (2026-10-28)

Written and checked against the code: delivery-overview, packages, stages (new, replaces stages-and-promotion), sign-off (new), schedules, rolling-back. Also fixed: runner tag table (no Release tag; Production takes scheduled runs), creating-a-new-build.

Checked in: `service/stage/{entry,run,schedule,stage,notice,timeline,hub}.go`, `service/release/release.go`, `service/runbuild/schedule.go`, `service/runner/runner_service.go`, `permission/permission.go`, migration 000024 (built-in groups), `web/src/component/{stage,release,approval,runbuild}`, `docs/plans/package-flow.md` (as built).

Open:
- Redirect from `/stages-and-promotion` to `/stages` (no redirect plugin installed yet).
- Diagrams `lifecycle.svg` and `stages.svg` redrawn in the dark card style; not yet looked at in a browser.
- Still stale, belongs to section 5: notifications.md and roles-and-permissions.md (stage requests, Release stage, "everyone sees every workspace"), and a check of drafts-and-change-sets and running-while-you-develop.
- Timeline: the plan said the package page "leads with" it; as built it is a Timeline button and Changes is the page. Docs follow the build.

### Section 5, Work as a team (2026-10-28)

New: workspaces. Rewritten: roles-and-permissions (the catalog had 14 keys; the old page listed ~25 removed ones), notifications. Corrected: drafts-and-change-sets (dev vs Base wording, submit-time checks, review outcomes), running-while-you-develop (dev schedules are visible and editable by everyone who can run in dev; the four "any user" permissions no longer exist), runner (shared runners are super-user only).

Checked in: `docs/plans/{workspace-scope,roles-and-permissions,package-flow}.md`, `permission/permission.go`, migrations 000024-000027, `service/{review,changeset,draft,wsaccess,runbuild}`, `server/routes/workspace_route.go`, `web/src/component/{admin,approval}`.

Found: workspace-scope.md D11 plans a Workspaces screen in the Admin portal; the UI has only Users and Groups (assignment is on the Users screen), so the docs describe that. The API for workspace members exists with no screen.

Open:
- Not yet viewed in a browser.
- The bell for the super user: the plan says never, `service/stage/notice.go` still returns rejections of packages they cut. Docs say never; confirm.
- Group editor screen not read in detail; the docs say groups can be edited, cloned and created, from the plan.

### Section 1, Start here (2026-10-28)

Rewritten: intro, setup-guide (Docker community package on port 9022 and native installers on 9090; first sign-in; runner; upgrading), architecture (delivery ending). New: quickstart (worked example is the Postgres daily-totals pipeline, adapted from `scripts/story-setup.py`). runner.md link fixed; sidebar order is intro, setup-guide, quickstart, architecture, runner.

Checked in: `README.md`, `DOCKER_COMMUNITY.md`, `docs/packaging.md`, `.env.example`, `docker-compose.yml`, `luenum/db_enum.go` (23 connector types), `etlfunnel-runner/packaging`, `web/src/component/common/navDrawerComponent.tsx`.

Open:
- RabbitMQ is a connector (enum, `connector/nosql/rabbitmq.go`) with no reference page.
- Quickstart UI steps (workspace creation, Run from Draft, review as super user) are checked against component labels, not by running the app; the code snippets are not compiled by me.
- Windows MSI `.env` generation is unverified in the code repo's own README; the setup guide repeats its fallback.
- runner.md says Windows is unsupported while the runner repo still ships `.ps1` scripts.

### Sections 2, 3, 4, 7, 8, theme and wrap-up (2026-10-28)

Theme: `src/css/custom.css` rewritten (dark glass by default, light mode kept, Sora / Source Sans 3 / IBM Plex Mono), a real landing page in `src/pages/index.tsx` (the old one redirected to /intro), navbar items and a footer in `docusaurus.config.ts`. Unused template components removed.

Sidebar is the eight-section story. `@docusaurus/plugin-client-redirects` installed (package.json, lockfile); `/stages-and-promotion` redirects to `/stages` (applies in production builds).

New pages: flow-graph-view, connector-catalog (from the engine's per-connector source methods), nosql-rabbitmq. Rewritten or corrected: connector-hub (tiers, creation steps), integration-webhook (two uses; alert backoff checked against `scheduler/alert_scheduler.go`), mcp (what MCP cannot do; workspace scope; port 9022 note), sql-postgres (three meta constants had the wrong names: `MetaPostgres*`, not `MetaPG*`). `streamhouse-findings.md` was an internal analysis that was published but unlisted; moved to `plans/`.

Automated checks run against `etlfunnel-execution`: every Go interface block in the docs matches the engine's method set (126 engine interfaces); every `models.X` name in the docs exists (after the Postgres fix); every EF code in ef-codes.md exists in the logger, and the logger's only extra codes are Qdrant's (E666, E667), which is not a studio connector; hub parameter tables match the engine's connection configs.

What was NOT verified: connector reference pages beyond those checks (behaviour prose, defaults, examples were not run or compiled); orchestrator, fixture, transformer, checkpoint, backlog, termination and write-rule pages were checked only for signatures; resource-collection, user-libraries and connector-entity prose were read, not tested; nothing was viewed in a browser, including the theme and the two redrawn diagrams.

Engine note: the engine's `catalog/connectors.go` says Postgres WAL is pgoutput only ("wal2json is not available"), while the SDK (`models/bridge_model.go`, `core/source/postgres`) still accepts WAL2JSON. The docs follow the SDK. Worth confirming which is intended.

### Theme revision (2026-10-28)

The first theme was a dark glass design with its own landing page. It was replaced with the website's look (tokens from `etlfunnel-website/web/styles/common.css`, navbar and footer from `nav.css` and `footer.css`), and the landing page was dropped in favour of the original redirect to `/intro`. Also fixed: a navbar that marked all four links active, tables forcing the page wider than a phone, and the "Edit this page" link that pointed at the Docusaurus template repository (editUrl removed).

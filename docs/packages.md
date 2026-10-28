# Packages

Dev changes every time a change set is approved. That is what you want while building, and exactly what you do not want in production, where you need to know precisely what is running. A **package** bridges the two: a frozen snapshot of the whole workspace, taken at the moment you choose, that never changes afterwards.

If you know git, the idea will feel familiar. The workspace is the repository, a change set is a pull request, dev is the main branch, and a package is a tag. Staging and Production never run dev; each runs one package.

:::note Package or release?
A package is the snapshot. A package becomes **released** when it is approved in Production, and then it is the one production's schedules run. "Released" is something that happens to a package, not a kind of package.
:::

## What goes into a package

A package holds everything that decides *how* things run: flows, collections, hooks, transformers, user libraries, connectors and their entities, and the other configuration items in the workspace.

It holds nothing about *where* things run. There are no database connections and no passwords in a package. Each stage supplies its own hubs and its own bindings, which is why one package can run against staging data on Monday and production data on Friday without a single change.

Packages are numbered per workspace: 1, 2, 3, and so on. The number only goes up and is never reused. Packages are kept for as long as the workspace exists, including the ones that were never promoted or that were rejected.

## Who can cut one

Cutting is its own permission, **Cut a package**, held by the Release manager group by default. Developers and reviewers cannot cut. Keeping it narrow is deliberate: the person who cuts decides what goes to staging, so it belongs to whoever owns Staging.

## Cutting a package

Open **Packages** in the **Delivery** group of the left navigation and choose the add button. In the **New package** dialog, give the package a name (up to 120 characters; it is required) and choose **Create**. Make the name say why you are cutting, for example "Discount field for orders". It is what reviewers and the bell show.

If you have Slack or Teams webhooks set up in the workspace, the dialog also offers **Notify channels**. Pick the ones that should hear that a package was cut. Choosing none posts nothing.

The snapshot is taken in a single instant, so every item in it comes from the same moment of dev, even if teammates are merging at the same time. Cutting runs nothing and changes no stage. It only freezes a version so that you can promote it.

If dev is identical to the latest package, ETLFunnel says "No changes since Package 13" and cuts nothing.

## Reading a package

The **Packages** page lists packages newest first. Open one to see what it changed against the package before it: every item added, modified or deleted. Open any row to see the old and new content side by side. The first package lists everything as new.

Two buttons at the top of a package open more:

- **Timeline** tells the package's whole story in one grid, latest first: the change sets that went into it (who wrote each, who approved it, their note), the cut (who, when, and which package it follows), each stage that took it in with how many runs completed and failed, and every verdict with who gave it and why. This is the page to read when asking "why was this cut, and how did it do in staging?".
- **Details** shows who created the package and when.

The origin record behind the Timeline is written once, at the cut, and never changes. It lists the change sets merged since the previous package. Because it is copied at the cut, it stays complete even after old change set records are pruned.

From a row's menu you can also **Promote** the package into a stage, covered in [Stages](./stages).

## Why a package is the whole workspace

It would be convenient to package only the pipeline you have just finished. ETLFunnel deliberately does not allow it, because the pieces of a workspace depend on each other in ways that cannot be worked out reliably. User libraries are shared by every pipeline. Hooks are Go code, and one can call another in a way nothing can see until a run fails at three in the morning. A snapshot of the whole workspace can never be missing a piece.

That shapes how you organise your work. If two pipelines need to ship on different days, keep them in **different workspaces**, the same way two projects live in two repositories. Within a workspace everything ships together, so a fix carries every unrelated change merged since the last package. Moving items between workspaces is not supported yet, so decide early which pipelines belong together.

## When a package is rejected

A rejection ends that package's trip. It is never approved later and it never moves on. The fix goes through dev as a normal change set, and someone cuts a **new** package, which starts again at Staging. The Timeline of the new package shows which package it follows, and the old package keeps the rejection and its reason. See [Sign-off](./sign-off).

# Run Presets

A run asks for a lot: what to run, why, which hubs, how verbose the logs are, how to retry, which webhook to tell. A **preset** saves those answers under a name, so the next run is one choice instead of a form. Presets are also what the [Public API](./public-api) starts runs from, which makes them the bridge between the screen and a script.

## What a preset holds

A preset is the definition of a run, not where it runs.

| Part | What it is |
| --- | --- |
| **Name** | Unique among your presets in the same workspace and tier. |
| **Tier** | Shared (dev), Staging or Production. Chosen when the preset is made and **fixed for life**. |
| **Root** | The one flow or collection it runs. |
| **Settings** | Purpose, tags, logging level, how pipelines run, retry policy and the webhook for run alerts. |
| **Hub bindings** | Dev presets only: the source, destination and auxiliary hub of each flow. A staging or production run takes its hubs from the stage's bindings, so those presets hold none. |
| **Machine orchestrator** | Optional. Saved when the preset describes a [run split across several runners](./distributed-runs). |

A preset deliberately holds **no runner**. Where a run runs is named each time the run starts, from the screen or from the API.

:::info A preset grants nothing
A preset is only saved input. Every time you use it, ETLFunnel checks again that you may run in that tier, that the flow, hubs and runner still exist and that the runner is allowed to take that tier's work. A preset can never do something you could not do by filling the form by hand.
:::

## Personal and tiered

- **Personal.** A preset belongs to the person who made it. Only its owner sees, uses, edits, clones and deletes it; nobody else does, the super user included. There is no sharing.
- **Tiered, like a hub.** A preset is made in one tier and stays there. A dev preset can never become a production one. To run the same thing in another tier, make a preset in that tier. Cloning keeps the clone in the same tier.
- **Permission follows the tier.** You see and use the tiers you hold the run permission for (`run:dev`, `run:staging`, `run:production`). If you lose one, that tier's presets disappear from your list and are refused. Nothing is shown greyed out.
- **No limit** on how many presets you have.
- **Not on the timeline.** Presets are run configuration, not code. They are not in change sets or packages, and editing one needs no review.

## Making a preset

You make a preset from the run form, the same one you use to start a run.

1. Open the run form and fill it in as usual: the flow or collection, purpose, logging level, tags, retry policy, webhook and, for a dev preset, the hubs.
2. Choose **Save as preset**, give it a name and confirm.

You can also open **Executions › Preset** and use the add button. It opens the run form's own steps in preset mode, without the runner step, and asks for a name.

:::tip Pick the tier first
The tier of a new preset is the tab you are on. The Preset page has one tab per tier you can run: **Shared** (dev), **Staging** and **Production**.
:::

## Starting a run from a preset

On the run form, **Start from preset** lists your presets for that tier, narrowed to the flow or collection you picked. Choose one and the form fills in. Then:

1. Choose the runner (or several, see [Runner at Scale](./distributed-runs)).
2. Change anything you want to differ for this run. The preset itself is not changed.
3. Start the run.

A run started from a preset is named after it, and it records the settings it actually used. Editing the preset later never changes a run that already happened.

## The Preset page

**Executions › Preset** lists your presets for the tier you pick. It looks and behaves like the other grids: search, load more as you scroll, select rows to delete in bulk.

| Action | What it does |
| --- | --- |
| **Open** | Shows and edits the preset. |
| **Clone** | Makes a copy. It asks only for a new name and stays in the same tier. |
| **Delete** | Removes the preset. Runs already started from it are untouched. |

The Preset entry appears only for people who can run in at least one tier. Clone and Delete are not shown for a tier you cannot run.

## When a preset breaks

A preset points at things that live elsewhere: a flow, hubs, a webhook, a machine orchestrator. If one of them is deleted, ETLFunnel does not change the preset. A run from it is refused with the message of the check that failed, and the preset is marked **Broken** (the public API reports `"broken": true`). Open it, point it at something that exists, and save.

If a preset's owner leaves the workspace or is deleted, their presets stay in the database but nobody can reach them.

## Using presets from scripts

The [Public API](./public-api) lists your presets, reads one in full and starts a run from it. A script can change only a few settings for a single run (see [Overrides](./public-api#overrides)); it can never change the root, the tier or the hubs, so a staging preset cannot start a production run.

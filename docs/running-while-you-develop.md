# Running While You Develop

The best time to find out that a change does not work is before anyone reviews it. In development you can run any flow or collection whenever you like, including your own unapproved edits, against databases set aside for development. This page explains how, and how to leave a run going on a timer.

Everything here happens in development and uses **development databases only**. Staging and production data are reached through a package and a stage, never from here; see [Stages and Promotion](./stages).

## Base or draft

When you start a run, the run window asks where the logic should come from.

**Run from Base** runs what has already been approved. Use it to see how things behave today, before your change.

**Run from Draft** runs base plus everything in your active change set: your edits, the items you have created and even the items you have deleted, so a library you removed is left out just as it will be once approved. Use it to prove your change works before you ask anyone to look at it. Draft is offered only when your active change set actually contains changes.

You then choose the source, destination and any auxiliary database for the run. Only development databases are offered. A draft run writes to them for real, so point it at a copy of the data, never at something you would mind losing.

A draft run is labelled as such in the run list, along with the change set it came from. It sends no webhook alerts and never counts as a run of any stage.

:::tip A run keeps its own copy
When a job starts, it copies everything it needs into its own folder. If you keep editing while it runs, the running job is not affected; the next run picks up your changes.
:::

## Leaving a run on a timer

Sometimes one run is not enough. You might want a draft to soak overnight against fresh data, or to rerun a base flow every hour while you investigate something. For that, create a **dev schedule**: choose a recurring run in the run window instead of a run now.

A dev schedule is recorded under its creator, its owner. It is not private, though: anyone in the workspace who may run in dev sees every dev schedule on the **Scheduled** page and can change, pause, resume or delete it, with no review. The runs it produces show up in the run list like any other development run.

Like a single run, a dev schedule runs from Base or from Draft. A **Base** schedule always picks up the latest approved version. A **Draft** schedule is tied to the change set that was active when its owner created it, and each run reads that set as it is at that moment, so edits you make along the way are included. The set may be open, waiting for review or sent back for changes; a set under review is a good thing to soak, because its content cannot change while the reviewer reads it.

### When a schedule stops running

A dev schedule that cannot run does not fail over and over. It quietly shows **Not running** on the Scheduled page, with the reason, and starts again by itself once the reason goes away. There are three reasons:

- **Its change set has closed.** The set was merged, deleted or removed. A closed set never comes back, so edit the schedule to run from Base, or delete it.
- **Its owner cannot run it.** The owner's account was deactivated, the owner was removed from the workspace, or the owner is no longer allowed to run in development. It resumes when that is put right.
- **No suitable runner.** The schedule's runner has no tag, or is tagged for another stage. It resumes once the runner is tagged correctly; see [Runner](./runner).

Pausing is a separate switch. A schedule can be paused and unable to run at the same time, in which case the page shows it as paused. Nobody is notified when a schedule stops running; check the Scheduled page, and the run list for failed runs.

Only the owner can tie a schedule to their own change set, so only the owner can switch it to run from Draft. Staging and production schedules are different: they belong to the stage, not to a person ([Schedules](./schedules)).

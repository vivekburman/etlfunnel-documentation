# Schedules

A schedule runs a flow or collection on a timer: every night at two, every hour, every Monday. Schedules are the part of ETLFunnel that keeps working after everyone has gone home, which is why what a schedule runs is tied to a signed-off package.

There are three kinds, one for each place a timer makes sense. The closer a schedule gets to production, the more is fixed about the code it runs.

## Three kinds of schedule

A **dev schedule** belongs to one person. It runs dev, or one of that person's change sets, against shared dev hubs. Its owner can create, change, pause or delete it at any moment. It is a personal testing tool and is covered in [Running While You Develop](./running-while-you-develop).

A **staging schedule** belongs to the Staging stage. It runs the package Staging **holds**, against staging hubs, so a package can soak on a realistic timetable before anyone approves it.

A **production schedule** belongs to the Production stage. It runs unattended against production hubs, and it runs the stage's **released** package: the last one approved in Production. Not the one Production happens to hold.

| | Dev | Staging | Production |
|---|---|---|---|
| Runs | Dev or one change set | The package Staging holds | The released package |
| Hubs | Shared dev hubs | Staging's bindings | Production's bindings |
| Create, change, delete | Its owner | Holders of `stage:staging:manage` | Holders of `stage:production:manage` |
| Pause, resume | Its owner, or someone allowed to | `run:staging` | `run:production` |
| Runner | Dev, or the owner's own | Tagged Staging | Tagged Production |

Stage schedules are made directly by the stage's owners. There is no request and no review: the control is the sign-off on the package they run.

## Why production runs the released package

Production holds two packages. When the owners promote a new candidate into Production and run it by hand, the nightly schedules **keep running the previous released package**. Only an approval in Production moves schedules onto the new code ([Sign-off](./sign-off)). That separation lets the team try Package 15 by hand on real data while the unattended runs stay on the Package 14 they trust.

Rejecting a candidate in Production changes nothing for schedules either: they stay on the released package.

A production schedule cannot be created until Production has a released package, since there would be nothing for it to run. A staging schedule needs Staging to hold a package.

## Creating and changing one

Open the **Scheduled** page. If you hold a stage's manage permission, the add button offers that stage as well as dev. A stage schedule names a flow or collection, a timetable, a runner and the usual run settings (logging level, how pipelines run, retry policy and an optional webhook for run alerts). It never names a hub: it uses the stage's binding when each run starts.

ETLFunnel checks it when you save, not at two in the morning:

- the timetable must be valid,
- the runner must exist and be tagged for that stage,
- the flow or collection must exist in the package the schedule will run, and
- it must be bound in the stage (give it its hubs under the stage's **Bindings** view first).

The flow or collection of a schedule is fixed when it is created. To schedule something else, create another schedule.

Deleting a stage schedule stops it and hides it. Its run history is kept.

## Pausing is the emergency stop

Pausing is separate from changing. It takes effect at once and needs no review, and it is allowed to anyone who can run in that stage (`run:staging` or `run:production`), not only the people who can edit the schedule. A paused schedule keeps its settings and history and simply does not fire until resumed. On the **Scheduled** page the Pause and Resume actions are shown only to people who may use them.

## When a schedule does not run

A schedule that cannot start says why on the **Scheduled** page ("Not running"). The common reasons for stage schedules:

- **The stage has no package to run**, or the package it would run does not contain the scheduled flow. The schedule waits quietly. It starts again when a package that contains the flow is promoted (staging) or approved (production).
- **The runner is not tagged for the stage.**
- **A real fault**, such as a hub that was deleted or is the wrong type. This one is not quiet: the run fails with a message naming the flow and the hub, so a broken schedule gets noticed.

Fix the cause and the schedule runs at its next tick.

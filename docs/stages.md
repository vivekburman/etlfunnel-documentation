# Stages

A package is frozen logic. A **stage** is a place where that logic runs against real databases. ETLFunnel has two stages after dev: **Staging** and **Production**. Each stage holds one package at a time, has its own databases and its own owners, and keeps a history of every package that has been through it.

<img src="img/page_delivery/stages.svg" alt="Dev runs dev and your drafts on shared dev hubs. Staging and Production each hold one package, run it on their own hubs and runners, and give a verdict on it. Production also keeps a released package." />

## The stages

**Dev** is where you build. It runs dev and your drafts against shared development hubs. You do not promote into dev; changes reach it by review. See [Running While You Develop](./running-while-you-develop).

**Staging** is where a package proves itself. It runs against staging hubs that should resemble production as closely as you can manage. Its owners run flows by hand and can schedule runs so a package soaks on a realistic timetable. When they are satisfied, they approve the package.

**Production** runs a package against production hubs. It holds two packages at once:

- the **held** package, the candidate the owners run by hand, and
- the **released** package, the last one approved in Production.

Manual runs use the held package. Production's schedules use the released one, so promoting a new candidate never changes what runs unattended; only an approval does. See [Schedules](./schedules).

## Promoting a package

**Promoting** puts a package into a stage so that the stage holds it. It is a direct act by the stage's owners, with no request and no second approval; the control is the sign-off that follows a run.

Open **Packages**, open a row's menu and choose **Promote**, or open the stage under **Delivery** and use the add (+) button on its History view. The **Promote to Staging** (or Production) dialog lists packages you can choose from, and **Promote** confirms.

The rules are strict and are enforced when you promote:

- **Newer only.** A stage can only move to a package newer than the one it holds. It never goes back.
- **Production needs staging's approval.** Production accepts only a package that was approved in Staging. Staging takes any package.
- **Once per stage.** A package enters a stage once. A rejected package never enters again; there is no second go.
- **No skipping.** A package cannot reach Production without having been approved in Staging.

There is no shortcut for hotfixes: an urgent fix is a change set, a new package, and the same two stages, only done quickly.

## The History view

Open a stage from the **Delivery** group in the left navigation. Its **History** view lists every package that entered the stage, newest first. Each row shows who promoted the package and when, how many runs completed and failed in this stage, and its status: **Approved**, **Rejected**, **Waiting** (the stage holds it and nobody has judged it yet) or **Replaced** (a newer package was promoted before it got a verdict). The stage's owners choose **Submit review** from a row's menu to approve or reject it. See [Sign-off](./sign-off).

## Hubs and bindings: where a stage runs

A package says *what* runs. A **hub** is a database connection, and a **binding** says which hub each flow uses in a stage.

Every hub has a **tier**: Shared (for dev), Staging or Production. The tier is chosen when the hub is created and is fixed afterwards. The **Connector Hub** screens show the three tiers as tabs. A run only ever uses hubs of its own stage's tier: staging can never read production data, and dev can touch neither. If you want production-like data in dev, copy it into a shared hub.

Staging and production hubs are managed **directly**, by people who hold that stage's hub permission (the Release manager for Staging, the Production approver for Production). There is no request and no review, because a reviewer cannot see a password or test a connection and would only be rubber-stamping. The safeguards are narrow permissions and these rules:

- **Passwords are write-only.** You enter them; nobody, including you, can read one back. Use **Test connection** on the hub form to check one.
- **Every change is recorded** with who, when and which fields changed, never the values.
- **A hub a flow still uses cannot be deleted.** The error names the flows. Rebind them first.
- **A change applies at the next run.** A run already started keeps what it began with.

Open a stage and switch to its **Bindings** view. It lists the package's flows and collections. Choose **Change hubs** on a row to set the source, destination and any auxiliary hub of each flow for this stage. A flow on its own and the same flow inside a collection are bound separately, and may use different hubs. If you need the same logic against two databases in one stage, clone the flow and bind each copy.

Bindings are checked when a run starts, not when you promote. A flow with an incomplete binding simply cannot run there yet, and the error names the flow and the missing hub. The hubs must also be of the stage's tier and of the same connector type the flow expects.

## Running in a stage

To run a flow or collection in Staging or Production, open the stage's **Bindings** view and choose **Run** from the row's menu (it is unavailable on a row with no binding yet). You choose the runner and the run settings; the package and the hubs come from the stage, so there is nothing to get wrong. The run history labels these runs with the stage and the package, for example "Staging · Package 14".

When a job starts, it freezes the package and bindings it will use. A job waiting in a queue picks them up when it starts, not when it was queued. A flow that is not in the stage's package cannot run there.

Each stage has its own run permission and its own [runners](./runner): a staging run is only picked up by a runner tagged for Staging.

## Who owns a stage

| | Staging | Production |
|---|---|---|
| Promote, approve, reject, manage schedules | `stage:staging:manage` | `stage:production:manage` |
| Run by hand, pause and resume schedules | `run:staging` | `run:production` |
| Manage hubs and bindings | `hub:staging:manage` | `hub:production:manage` |
| Built-in group | Release manager | Production approver |

The full list is in [Roles and Permissions](./roles-and-permissions).

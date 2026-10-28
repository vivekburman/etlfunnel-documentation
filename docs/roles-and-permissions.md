# Roles and Permissions

A review process is only as good as the rules about who may do what. In ETLFunnel those rules come from **groups**. A group is a named set of permissions, and every person holds one group **in each workspace they are assigned to**: edit, review, run in a stage, own a stage.

Groups decide *what* you can do. Workspaces decide *where*: you hold your group's permissions only in the workspaces you are assigned to, and see nothing in the others ([Workspaces](./workspaces)).

## The built-in groups

ETLFunnel ships with six groups. You can edit them, clone them, or create your own, from the **Admin portal**.

| Group | Can do |
|---|---|
| **Viewer** | Read everything in the workspace, change nothing. For auditors, managers and anyone following along. |
| **Developer** | Build: edit, create, delete and rename items, submit change sets, run in dev, manage dev hubs. |
| **Reviewer** | Everything a Developer can, plus approve other people's change sets. |
| **Release manager** | Everything a Reviewer can, plus cut packages and own **Staging**: run there, manage its hubs and bindings, promote into it, approve or reject there, manage its schedules. |
| **Production approver** | Owns **Production**: run there, manage its hubs and bindings, promote into it, approve or reject there, manage its schedules. Does not build. |
| **Operator** | Everything a Developer can, plus delete run records and logs and manage webhooks. |

The split between Release manager and Production approver is deliberate. Whoever approved a package in Staging cannot approve it in Production, so reaching production always takes two people ([Sign-off](./sign-off)).

## The super user

Every company has exactly one **super user**, created along with it. The super user:

- manages people, groups and workspaces through the **Admin portal**,
- is in every workspace and holds every permission in it,
- manages shared runners,
- may decide a change set even if they wrote it, and may approve a package in Production even if they approved it in Staging, so a very small team is never stuck.

The super user is not in a group and is not sent review notifications, so they are not pulled into daily review. They can still open and decide any change set by browsing. Nobody can edit, deactivate or delete the super user.

On a new installation the super user is `admin` with the password `admin`. Change it as soon as you sign in. Additional companies on the same installation each get their own super user and need their own license; the free community edition has a single company.

## How reviewing groups work

When you submit a change set, you choose which **groups** should review it, never individual people. A group is offered only if it holds the approve permission and has at least one active member **assigned to this workspace**. Any one member of the chosen groups can decide, and the first decision settles it.

Access is checked on every request. If someone leaves a workspace, or their group loses a permission, they stop seeing the review and cannot decide it from the next request.

Nobody except the super user can approve their own change set, so a team needs at least two people who can approve before anything can be merged.

## Managing people

Only the super user adds, deactivates and deletes people, assigns them to workspaces, and resets passwords.

A **deactivated** person cannot sign in and is signed out of open sessions within moments. They keep their assignments and their work, and reactivating them restores everything. While deactivated, they do not count as an available reviewer.

A **deleted** person's unfinished change sets are set aside and kept for 90 days. Anything they had already submitted stays with its reviewers, and their name still appears on their past work, marked as deleted.

Resetting a password signs the person out everywhere. Nobody can deactivate or delete themselves. A group that still has members cannot be deleted; move them first.

## What you see

ETLFunnel hides what you cannot do instead of greying it out. A Viewer has no Submit button; someone without the Staging permission never sees **Submit review** on the Staging page. The one exception is a page you are not allowed into, which stays visible but locked.

The same rules apply however you reach ETLFunnel: through the browser, the API or an AI assistant using [MCP](./mcp). MCP is narrower still. It works on drafts like a person does, but it has no tools to submit, review or approve change sets, cut packages, act on stages, or manage users.

## Permission reference

For administrators who build their own groups, here is every permission a group can hold.

| Area | Permission | Allows |
|---|---|---|
| Content (dev) | `entity:edit` | Work in dev: save drafts, create, clone, delete, and submit a change set |
| | `entity:rename` | Rename items directly |
| | `changeset:approve` | Approve, request changes on or discard a change set in review |
| Runs | `run:dev` | Run from Base or Draft; manage dev schedules; stop dev runs |
| | `run:staging` | Run in Staging; pause and resume its schedules; stop its runs |
| | `run:production` | Run in Production; pause and resume its schedules; stop its runs |
| | `run:delete` | Delete run records and logs |
| Hubs | `hub:dev:manage` | Create, edit and delete shared (dev) hubs; test connections |
| | `hub:staging:manage` | The same for Staging hubs, and choose the hubs of a Staging flow |
| | `hub:production:manage` | The same for Production hubs |
| Packages and stages | `release:cut` | Cut a package |
| | `stage:staging:manage` | Promote into Staging, approve or reject there, manage Staging schedules |
| | `stage:production:manage` | Promote into Production, approve or reject there, manage Production schedules |
| Integrations | `webhook:manage` | Create, edit and delete webhooks |

Holding a later stage does not imply an earlier one: each stage is granted separately, because the people who run production are often deliberately not the people who edit dev.

**Open to everyone signed in:** reading everything in your workspaces, editing your own profile, working with your own change sets and drafts (hold, resume, withdraw, delete), the bell, trash, run logs and metrics, registering a personal runner and downloading the runner program.

**Super user only, not a permission:** users, groups, workspaces (create, delete, storage settings) and shared runners.

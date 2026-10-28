# Workspaces

A **workspace** is one project: its connectors and hubs, flows, collections, transformers and libraries, its change sets, its packages, and what each stage runs. Workspaces do not share any of that. They are also the boundary of access: a person sees and works in the workspaces they are **assigned** to, and in no others.

Start by deciding what a workspace is for. A package always contains a whole workspace ([Packages](./packages)), so two pipelines that must ship on different days belong in different workspaces, the same way two projects live in two repositories.

## Who sees what

Every person (other than the super user) is assigned to one or more workspaces, and holds **one group in each**. The group decides what they can do there ([Roles and Permissions](./roles-and-permissions)).

- The workspace picker lists only the workspaces you are assigned to.
- A person can be a Developer in one workspace and a Viewer in another. What you may do is read from your group in the workspace you have open.
- Nothing crosses the boundary. Asking for something by its id from another workspace is answered as "not found", and a run cannot name another workspace's flow or hub.
- Every person keeps at least one workspace. Removing someone's last assignment is refused.

The **super user** is the exception. They are in every workspace, hold every permission in it, and are not tied to a group. A new workspace is reachable by the super user alone until they assign someone.

## Creating and deleting

Only the super user creates a workspace, deletes one, or changes its storage settings.

A workspace cannot be deleted while it is somebody's only workspace. The error names those people, and the super user assigns them elsewhere first.

Each workspace has **Storage Settings**: the disk space it uses, and when old build folders and archived logs are purged (**None**, **One Time** or **Periodically**).

## Assigning people

The super user assigns people from the **Admin portal** in the top-right menu, on the **Users** screen:

- Each person's row shows chips such as "Data Project · Developer", one per workspace, and you can filter the list by workspace.
- Open a person to change the group in a workspace, remove a workspace, or choose **Add to workspace**.
- Creating a person needs at least one workspace and a group in it.

A change takes effect on the person's next request. They do not need to sign out.

### What happens when someone is removed from a workspace

Removal is reversible, and nothing of the person's work is destroyed.

- They stop seeing the workspace. Their drafts and unfinished change sets stay but are out of their reach; reassigning them brings everything back.
- Change sets they already submitted stay with their reviewers and can still be merged, with the author's name on them.
- Their code editor connection to the workspace is closed and their editor folder is deleted. Drafts are saved in the database and survive. Only a file written straight into the editor folder, outside a draft, is lost.
- Their **dev schedules** show "Not running" and wait. They run again if the person is reassigned with permission to run in dev.
- **Staging and production schedules are not affected.** They belong to the stage, not to a person.

## Runners are shared across workspaces

A shared runner serves the stage it is tagged for, in every workspace. Because a shared runner receives the credentials a stage's jobs need, registering, retagging, deleting or rotating the key of one is the super user's job. Anyone signed in can register a **personal** runner, and it takes work only in workspaces where its owner is still assigned and may run in dev. See [Runner](./runner).

# Flow Graph View

A flow is a definition: a source, a destination, and pipelines with their transformers and hooks. The **Graph** view draws that definition as a picture, so you can see how a flow is wired and open any piece of it.

## Opening it

Open a flow from **Builder › Flow**. At the top of the flow, switch between **Definition** and **Graph**.

The graph is drawn from the flow as you have it open, with your drafts applied. It needs no extra loading. It is available only while you are **not editing**: while a flow is open for editing, only **Cancel** and **Save draft** are shown, so there is no graph of unsaved edits. Save the draft, and the graph shows it.

## Reading it

Each pipeline is drawn as the path its records take: the source connector entity, the transformers in order, and the destination connector entity. Around the path sit the pieces that shape it: the checkpoint, backlog, termination rule and destination write rule of each pipeline, and the flow's orchestrator, fixtures and auxiliary hubs.

| Node | Meaning |
|---|---|
| Source, Destination | The connector entity that reads or writes |
| Transformer | One step of your transformation chain, in order |
| Checkpoint | Saves progress after a successful write |
| Backlog | Catches records that failed to write |
| Terminate rule | Decides when to stop |
| Destination write | Tunes the write batch |
| Orchestrator | Decides how many copies of the pipeline run |
| Fixture | Setup or teardown that runs around the flow |
| Auxiliary hub | An extra connection for lookups or enrichment |

A node can be in one of four states:

- **Ready**: it exists and is live.
- **Unset**: the slot is empty. Optional hooks that you have not chosen show this way.
- **Deleted**: the item it points to was deleted. The graph shows its name and when it was deleted, so you can see why a run would fail.
- **Missing**: the item it points to no longer exists at all.

Spotting a deleted or missing node here is faster than finding it from a failed run. It is also the picture to read when a reviewer asks "what does this flow actually do?".

## Opening the code of a node

Click a node to open its code in a read-only viewer, the same code the editor shows. Source and destination bindings have no code of their own; open the connector entity instead. Nothing is changed by looking.

## Refresh

The refresh icon reloads the flow and everything it points to. It is shown only while you are not editing, next to the Definition and Graph switch.

## Graphs of collections and runs

A **collection** has the same kind of graph, with its flows drawn together. A **run** draws its own graph, showing the names it ran under and the exact files it ran, which is how you tell what a past run did even after the flow has changed. See [Collections](./resource-collection) and [Creating a New Build](./creating-a-new-build).

# Drafts and Change Sets

Every edit you make in ETLFunnel starts private. You can try ideas, break things and fix them again without anyone else noticing, until you are ready to ask a teammate to look. This page covers that first journey: from your first save to the moment a reviewer approves your work and it becomes part of **base**, the approved, current version of the workspace, called **dev**. (The run window calls it **Base**: Base and dev are the same thing.)

Nothing on this page touches production. Approval makes a change part of dev; shipping it is a separate step, described in [How a Change Reaches Production](./delivery-overview).

## Your edits are drafts

When you save a flow, a transformer, a hook, a user library or any other item, you are not changing the item everyone else sees. You are saving **your draft** of it. Your teammates keep seeing dev, and nothing that runs in a stage can pick up your draft.

While a draft exists, the editor and the lists show it to you in place of dev, so you always see your own latest work.

Creating something new works the same way. A new flow, or a clone of one, exists only for you until your work is approved. Two people can each be creating a flow called `orders_sync` without getting in each other's way. If both are approved, whoever comes second is asked to choose another name.

Deleting is a draft too. The item stays live for everyone else until your work is approved; in your own lists it moves into your change set, where **Undo** brings it back. Once approved, a deleted item waits in **Trash** for 90 days, and restoring it is simply another change for someone to approve. After 90 days it is gone for good.

The one change that takes effect immediately is a **rename**. A name is only a label, since everything in ETLFunnel refers to items by their id, so renaming something can never break a reference or change what runs.

## Change sets keep related edits together

Your drafts are gathered into a **change set**. Think of it as one piece of work: a flow and the transformer it needs belong together, so they are reviewed and approved together. A change set is identified by its number, such as Change set #42, and the note you add when you submit it says what it is for.

You always have one **active** change set in a workspace. Your edits go into it, and if you have none, ETLFunnel opens one on your first save. When something more urgent comes up, choose **Put on hold**: the set steps aside, your next edit starts a fresh one, and **Resume editing** brings the held set back later. You can keep up to ten unfinished change sets per workspace. Sets waiting for review do not count toward that limit. At ten, ETLFunnel asks you to merge, discard or delete one before starting another.

A change set is submitted whole and approved whole. If you find yourself with two unrelated changes in one set, put it on hold and start a new set for the second change; that keeps each review small and easy to judge.

<img src="img/page_delivery/change-set-states.svg" alt="A change set is Open, then In review once submitted. A reviewer approves it to Merged, or requests changes. A deleted set is Abandoned and can be restored for 90 days." />

## Asking for a review

When your work is ready, choose **Submit for review**. You add a short note and pick one or more **groups** to review it, such as Reviewer. Only groups that can approve, and have at least one active member, are offered. You can also pick Slack or Teams channels to notify; see [Notifications and Webhooks](./notifications).

ETLFunnel checks the set first and refuses to submit one with a problem: an empty set, an item that changed in dev since you drafted it, a name now taken, or a reference to something that does not exist. The problems are listed on the set's page. Warnings, such as a reference to something being deleted, do not block.

Once submitted, the change set is **locked**, so the reviewer approves exactly what they read. You do not have to wait: your next edit opens a new change set and you carry on working. If you spot a mistake while it is waiting, choose **Withdraw from review**. The set returns to you, open and active again, and you can submit it once more when it is fixed.

## Reviewing a change set

A reviewer sees a single page listing every item in the change set, each with its difference against dev shown side by side. Problems are flagged on the same page, such as a flow that refers to something that no longer exists.

The reviewer then makes one of three choices:

- **Approve and merge** applies every change in the set to dev, in one step.
- **Request changes** sends the set back. A comment is required. The author edits the same drafts and chooses **Resubmit for review**.
- **Discard** ends the set. The author's drafts are kept for 90 days.

Choose **Review** on the set, pick the outcome, and confirm with **Submit your review**.

Any one member of the chosen groups can decide, and one approval is enough. Whoever acts first settles it.

You can never approve your own change set. The only exception is the company's super user, so that a team with a single approver is never stuck. In practice this means a team needs at least two people who can approve before anything can be merged.

## When two people change the same thing

The first change set to be approved wins. If your set touches an item that someone else's set changed first, or takes a name that someone else has just used, ETLFunnel will not quietly merge the two. The merge is refused, nothing is applied, and the set comes back to you marked **Changes requested**, with the problem listed. You look at the new difference, bring your change up to date by hand, and resubmit. Changes elsewhere in dev that do not touch your items never get in the way.

A flow is a single item, so two people editing different parts of the same flow will still meet here. If that happens often, it is usually a sign the flow wants to be split.

## Cleaning up

You can delete any of your own unfinished change sets with the **Delete change set** button. ETLFunnel asks you to type "delete" to confirm. A deleted set is not lost straight away: it stays restorable for **90 days**, and **Restore** brings it back on hold. A set a reviewer discarded is kept the same way.

Unfinished work does not live forever. A change set nobody has edited for a year is removed. A merged change set's record, with its reviews, is kept for a year after it was merged. A set waiting for review is never removed automatically; it waits for its reviewers. Items deleted by an approved change set wait in **Trash** for 90 days.

If someone leaves the company and their account is deleted, their unfinished change sets are abandoned and kept for 90 days. Anything they had already submitted stays with its reviewers.

## Working through MCP

An AI assistant connected through [MCP](./mcp) works on drafts like everyone else. Its creates, edits and deletes land in the active change set of the account it uses. A person then submits that change set from the browser. MCP has no access to the review process itself: it has no way to submit, hold, withdraw, review or approve a change set, and none to cut packages or touch the stages.

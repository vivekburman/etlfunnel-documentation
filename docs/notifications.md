# Notifications and Webhooks

Review and sign-off only work if people know there is something for them to do. ETLFunnel tells them in two ways: the **bell** inside the app, and messages to your team's Slack or Microsoft Teams channels.

## The bell

The bell in the top-right corner holds what is waiting on you, across every workspace you are assigned to. It shows three kinds of entry.

**Change sets to review.** Every change set sent to a group you belong to, where you hold the approve permission in that workspace. Each entry shows the change set, who sent it and how long it has waited. Choose one to open its review, even from another workspace. Once you or someone else in the group decides it, it leaves your list.

**Packages ready for you.** When a package is approved in Staging, the owners of Production see "Package 14 is ready for Production". When it was approved earlier in the line, the same goes to the next stage's owners. The entry names the workspace and who approved. It has no time limit, because it is a to-do. It clears when the package is promoted, rejected, or passed by a newer one.

**Your packages that were rejected.** Whoever cut a package sees "Package 14 was rejected in Staging", with the reviewer's reason. It stays until you cut a newer package, which is the fix, or for 90 days, whichever comes first. There is no dismiss button, since the new package is what clears it.

The bell reads its count when the page loads and the list when you open or refresh it. It does not poll, so reopen it to see something new. It is shown to anyone who can review change sets, cut packages or own a stage, and never to the super user, who is not pulled into daily review.

The bell is about what others are asking of you, not about how your own work fared. Your own change sets, with their state and any reviewer comments, live in the **Change sets** panel, and a package's story is on its **Timeline** ([Packages](./packages)).

## Webhooks

Not everyone has ETLFunnel open all day. A webhook posts short messages to a Slack or Microsoft Teams channel so the team knows when something needs attention or has been decided.

### Setting one up

Webhooks belong to a workspace. Someone allowed to manage webhooks creates one, gives it a name, chooses Slack or Teams and pastes the channel's webhook URL. **Test** sends a sample message so you can check it arrives.

Treat that URL as a secret, because anyone holding it can post to your channel. ETLFunnel never shows it to the people choosing which channels to notify.

### What gets posted

You choose the channels in the dialog of the action itself, under **Notify channels**. Choose none and nothing is posted. Your last choice in a workspace is remembered in your browser.

| When | Where you choose channels | Message |
|---|---|---|
| A change set is submitted, merged, sent back for changes or discarded | The Submit for review dialog | Names the change set, its author and how many changes it holds |
| A package is cut | The New package dialog | Names the package, who cut it and the workspace |
| A package is approved or rejected | The Review dialog in the stage | Names the package, the stage, who acted, who cut it and the workspace |

Promoting a package into a stage posts nothing.

Messages never include a reviewer's comment and carry no link. Review comments can be candid, and a channel may be read by many people. A message is sent after the action has gone through, in the background, with one retry. If it fails to send, the action is not held up or undone.

A webhook cannot target one person. To notify someone in particular, rely on the bell.

### Run alerts

A webhook can also be attached to a run or schedule, to post when new errors appear while a job is running. Draft runs never send these alerts.

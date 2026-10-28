# Sign-off

Running a package in a stage proves it works. **Sign-off** is the person who owns that stage saying so. It is the only gate between a package and the next stage, and it is the last decision in the delivery path, so it is worth understanding exactly.

## What a sign-off is

After a package has been promoted into a stage and run there, the stage's owner gives it one **verdict**:

- **Approve.** The package is good for this stage. In Staging, this unlocks promoting it into Production. In Production, it makes the package **released**.
- **Reject.** The package is not good, and the owner must say why.

A verdict records who gave it, when, and the comment. It cannot be changed afterwards.

## Giving a verdict

Open the stage from the **Delivery** group, stay on its **History** view, and choose **Submit review** from the package's row menu. The **Review** dialog shows the package and stage, and a line about its runs there, for example "3 completed and 1 failed runs in Staging". Choose **Approve** or **Reject**, add a note, and confirm.

- A **rejection needs a comment**. An approval can carry an optional note for the record.
- If the package has no completed run in the stage, the dialog warns you ("Not run in Staging yet", or "No completed run in Staging (2 failed)") but still lets you approve. A run is good to have, not required. The warning is there so that approving a package nobody ran is a choice you make with your eyes open.
- A verdict applies only to the package the stage **currently holds**. If a newer package has been promoted meanwhile, the older one is marked **Replaced** and can no longer be judged.
- If your workspace has Slack or Teams webhooks, the dialog offers **Notify channels**. The message names the package, who acted, who cut it and the workspace. It never includes your comment and carries no link. Choosing none posts nothing.

## Two people, not one

Whoever approved a package in Staging **cannot approve it in Production**. A different person must. This is what makes "nobody approves their own work" true across stages: even if one person cut it, ran it and approved it in Staging, a second person has to sign it off before it is released. The super user is exempt, so that a very small team is never stuck.

For this to work you need at least two people who can give verdicts, one holding the Staging permission and one holding the Production permission. The built-in Release manager and Production approver groups give you that.

## What approval does in Production

An approval in Production does two things: it records the verdict, and it makes that package the stage's **released** package. Production's schedules run the released package, so approval is the moment unattended runs switch to the new code. Until then, schedules keep running the previous released package, even though Production already holds the newer candidate for manual runs. See [Schedules](./schedules).

## What rejection does

A rejection ends that package's trip. It is never approved later, never promoted again, and cannot be edited. The fix goes through dev as a normal change set; then someone cuts a **new** package, which begins again at Staging. This is true even if the rejection happened in Production.

A rejection in Production does not change what is already released. Schedules keep running the last released package until a newer one is approved.

## Who is told

- When a package is approved in one stage, the owners of the next stage see **"Package N is ready for Production"** in their bell. It stays until the package is promoted, rejected, or passed by a newer package.
- When a package is rejected, whoever cut it sees **"Package N was rejected in Staging"** with the reason in their bell. It stays until they cut a newer package, or for 90 days, whichever comes first. There is no dismiss button: the new package is what clears it.

See [Notifications and Webhooks](./notifications) for the bell and for Slack and Teams.

## Who can give a verdict

The Staging permission (`stage:staging:manage`, built into the Release manager group) and the Production permission (`stage:production:manage`, built into the Production approver group). The same permission lets the holder promote packages into the stage and manage its schedules. If you do not hold it, the **Submit review** action is not shown.

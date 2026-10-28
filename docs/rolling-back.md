# Rolling Back

Sooner or later a package that looked fine in Staging misbehaves in production. You want two things, fast: to stop the damage, and to get back to something that worked. ETLFunnel gives you both, but it does it by moving forward rather than rewinding.

## Stop the damage first

If unattended runs are the problem, **pause** the affected schedules on the **Scheduled** page. Pausing takes effect at once and needs no review. Anyone who can run in Production (`run:production`) can do it, so whoever is on call can act immediately. Paused schedules wait with their history intact until someone resumes them.

If the trouble came from a manual run of a new candidate, nothing else is exposed: production's schedules run the **released** package, not the candidate. Reject the candidate in Production and the schedules carry on with the package they were already running ([Sign-off](./sign-off)).

## Then move forward to a good state

A stage never goes back to an older package: promotion only accepts a newer one. To recover, you make the fix the normal way:

1. Correct dev with a change set that restores the behaviour you want, and have it reviewed and approved.
2. Cut a new package from the corrected dev.
3. Promote it into Staging, run it, approve it. Promote it into Production (a different person approves it there), run it, approve it. That approval makes it released, and schedules move onto it.

This can feel slower than a rollback button, and for a true emergency it takes a little longer. In exchange, the fix is reviewed like everything else, so a hurried change cannot make things worse unseen, and every state production has ever run remains a numbered package you can open and read.

Earlier packages are your best reference while you prepare the fix. Open the package that last worked and compare its items with the current ones to see exactly what changed. A package's **Timeline** shows which change sets went into it and who approved them, so you can see which change to reverse.

:::note Not available yet
ETLFunnel cannot yet cut a package as a copy of an earlier one, which would let you re-promote known-good content without editing dev first. Today, every package is a snapshot of current dev.
:::

## Undoing a change in dev

Dev also only moves forward. To undo an approved change, make a new change set that reverses it and have it approved like any other.

Two conveniences you might expect are not available yet. ETLFunnel does not keep earlier versions of an individual item after a change is approved, so you cannot check out an old version of a single transformer; the packages, and the copy each run keeps of what it ran, are your record. Nor is there a one-click way to revert a merged change set.

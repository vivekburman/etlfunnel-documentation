# How a Change Reaches Production

A data pipeline is code that touches real data. A one-line change to a transformer can rewrite a million rows by morning. ETLFunnel treats that seriously: nothing you change reaches the dev version of your workspace until someone else has reviewed it, nothing reaches production until the package has run in staging and a person has signed it off, and at every step you can see who did what, and when.

This page is the map. Read it once and the rest of this section will feel familiar.

<img src="img/page_delivery/lifecycle.svg" alt="A change moves from a draft, through review, into dev. A package is cut from dev, taken into staging, run and approved there, then taken into production, run and approved there, which releases it." />

## One line, two halves

Your workspace is a single line of history, like the main branch of a repository. There are no release branches. Every change goes onto that line, and every package is a slice of it, taken at the moment you choose.

The line has two halves.

**Making the change** happens in **dev**. You edit a flow or a transformer, try it against a development database, and ask a teammate to review it. When they approve, the change **merges** into dev, the current, approved version of the workspace. Nothing outside dev has moved.

**Delivering the change** starts when someone cuts a **package**: a frozen snapshot of the whole workspace as dev stands. The package then travels through **Staging** and **Production**. At each stage the same three things happen: a person **promotes** the package into the stage, the team **runs** it there, and the stage's owner **approves or rejects** it. An approval in production marks the package **released**.

Why two halves? Because "this change is correct" and "this change should go live today" are different decisions, usually made by different people, and they should not be tangled together.

## Making the change

Say Maya needs to add a `discount` field to `orders_flow`, and the transformer behind it must handle the new field.

Maya edits the flow and the transformer. Neither save is live. Both are **drafts**, private to Maya and gathered into one **change set**, a unit of work that travels as a whole. Before asking anyone, Maya runs the flow **from the draft** against a development database to see the field come through.

She submits the change set to a reviewing group. Theo, a reviewer, sees both edits next to what dev has today and approves. In that moment both edits merge into dev, together or not at all.

Read more in [Drafts and Change Sets](./drafts-and-change-sets) and [Running While You Develop](./running-while-you-develop).

## Delivering the change

On Thursday, Ines, who holds the Release manager group, cuts **Package 14** and names it "Discount field". The package holds Maya's change and everything else merged into dev so far. It holds logic only (flows, transformers, hooks, libraries, connectors); never database connections or passwords.

Ines **promotes** Package 14 into Staging and runs it against staging databases a few times. Satisfied, she **approves** it in Staging. If something was wrong she would **reject** it with a reason, and the fix would go back through dev as a new package.

Omar, the Production approver, now promotes Package 14 into Production. Production only accepts a package that Staging has approved. Omar runs it by hand against production data. Then he **approves** it, and Package 14 becomes production's **released** package. From then on, production's **schedules** run Package 14 unattended.

Omar could not have approved it in Production if he had approved it in Staging as well. Nobody signs a package off at both stages (the super user is the one exception). That is the one place where two different people are guaranteed to have looked at what runs in production.

Read more in [Packages](./packages), [Stages](./stages), [Sign-off](./sign-off) and [Schedules](./schedules).

## Where the data lives

Each stage has its own databases, called **hubs**, and a run can only use the hubs of its own stage. Development uses shared dev hubs, Staging uses staging hubs and Production uses production hubs. A flow in a package does not say which hubs it uses; each stage's **bindings** say that. A typo in a draft cannot reach production data, because a draft run is not allowed to choose a production hub in the first place.

The same separation applies to the machines that do the work: each [runner](./runner) is tagged for one stage and only takes jobs from it.

## Who can do what

People get their abilities from the **group** they belong to in each workspace: Viewer, Developer, Reviewer, Release manager, Production approver or Operator. Cutting a package, owning Staging and owning Production are three separate abilities. If you are not allowed to do something, the button is not there. See [Roles and Permissions](./roles-and-permissions).

## Who is told

Nobody has to watch a page. The **bell** tells the owners of the next stage when a package is ready for them, and tells whoever cut a package when it was rejected. Cutting, approving and rejecting can also post to Slack or Teams. See [Notifications and Webhooks](./notifications).

## When something goes wrong

There is no button that rewinds a stage, and a stage never goes back to an older package. To stop damage you **pause** the affected schedules; to recover you fix dev, cut a new package and take it through again. Every state production has ever run is still a numbered package you can open and read. See [Rolling Back](./rolling-back).

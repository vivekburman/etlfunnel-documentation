# Webhook

A webhook posts short messages to a Slack or Microsoft Teams channel so your team hears about things without watching a dashboard. ETLFunnel uses them for two jobs:

- **Run alerts**: a message when a running job starts producing errors. Described on this page.
- **Review and release messages**: a message when a change set is submitted, merged, sent back or discarded, and when a package is cut, approved or rejected. See [Notifications and Webhooks](./notifications).

<img src="img/page_resource/webhook.png" alt="Webhook Integration" height="300" />

## Supported integrations

- **Slack**: post to a channel through an incoming-webhook URL.
- **Microsoft Teams**: post to a channel through a webhook URL.

## Setting one up

Webhooks belong to a workspace and are managed by people who hold the **Manage webhooks** permission (the Operator group by default).

1. Create the incoming webhook in Slack or Teams and copy its URL.
2. In ETLFunnel open **Integrations › Webhook** and create one: give it a name, choose Slack or Teams, and paste the URL.
3. Choose **Test connection**. A sample message should arrive in the channel.
4. Save only once the test has arrived.

Treat the URL as a secret: anyone holding it can post to your channel. ETLFunnel never shows it to the people who choose channels to notify.

:::tip
Test before saving. A webhook that was never tested is the usual reason an alert is missed.
:::

## Run alerts

Attach a webhook to a run or schedule in its settings. While that job is **running**, ETLFunnel watches its error counts. When new errors appear, it posts an alert. Draft runs never send alerts.

### Backoff

To keep an extended outage from flooding the channel, alerts for one run back off exponentially:

- The **first** error alert is sent at once.
- After that, the next alert for the same run waits 1 minute, then 2, 4, 8, 16, and never more than **30 minutes**.
- An alert is sent only if new errors appeared since the last one.

When the job finishes, its alerts stop.

## What messages never contain

Messages name what happened, who did it and where. They never include a reviewer's comment and carry no link. A message that fails to send never holds up or undoes the action behind it.

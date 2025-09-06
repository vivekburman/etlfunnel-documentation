---
sidebar_position: 10
---

# Webhook

Webhooks provide real-time notifications for your ETL operations, allowing you to stay informed about critical events without constantly monitoring the dashboard. Our ETL tool uses webhooks to automatically notify you when any build encounters an error, ensuring rapid response to data pipeline issues.

<img src="/img/page_resource/webhook.png" alt="Webhook Integration" height="300" />

## Supported Integrations

We currently support webhook integrations with:

- **Slack** - Send notifications to channels or direct messages
- **Microsoft Teams** - Post alerts to team channels

## Notification Behavior

### Error Alerting
Webhooks are triggered when:
- **Pipeline Failures** - When any ETL pipeline encounters an error
- **Build Errors** - When transformation or data loading processes fail
- **Connection Issues** - When database connectivity problems occur

### Exponential Backoff
To prevent webhook flooding, our notification system implements exponential backoff:

- **First Error** - Immediate notification
- **Subsequent Errors** - Notifications are delayed exponentially (1min, 2min, 4min, 8min...)
- **Maximum Delay** - Caps at 30 minutes between notifications

This ensures you're informed of issues without being overwhelmed by repetitive alerts during extended outages.

## Configuration

### Webhook Setup Process
1. **Create Webhook** - Set up the webhook URL in Slack or Teams
3. **Test Connection** - Use the "Test Connection" button to verify the webhook works
4. **Save Configuration** - Only save after confirming the test is successful

:::tip Test Before Saving
Always test your webhook connection before saving the configuration. This ensures notifications will be delivered when actual errors occur.
:::

This integration keeps your team immediately informed of ETL issues, enabling faster resolution and maintaining data pipeline reliability.
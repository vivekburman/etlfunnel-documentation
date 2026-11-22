# Personal Access Token

A **personal access token** (PAT) lets a script or tool act as you through the [Public API](./public-api) without a browser sign-in. You make one for yourself, in your profile settings, and it carries your own permissions: whatever you can do in the workspaces you belong to, the token can do through the API, and nothing more.

## Get a token

1. Open the user menu and choose your profile settings.
2. Find **Personal access token** and choose **Create token**.
3. Copy the token from the dialog. **It is shown once.** ETLFunnel keeps only a fingerprint of it, so it cannot be shown again.

Tokens start with `efpat_`. The fixed start lets secret scanners recognise one if it leaks into a repository. The profile page afterwards shows only the first characters, so you can tell which token you hold, and when it was made.

Store it where you store other secrets: your CI system's secret store, not a file in a repository.

## Rules

| Rule | Detail |
| --- | --- |
| **One at a time** | You have at most one token. Creating again replaces it. |
| **Does not expire** | A token works until you regenerate or delete it, or your account stops working. |
| **Acts as you, live** | Each call is checked against your current permissions and workspaces. Lose the run permission for staging and the token stops working for staging. |
| **API only** | The token works on the [Public API](./public-api) and nowhere else. It cannot sign in, cannot be exchanged for a session, and is refused by the screens and by [MCP](./mcp). |
| **Cannot manage itself** | A token cannot create, regenerate or delete tokens, change a password or approve a change set. Those need you signed in. |
| **Independent of sessions** | Creating, regenerating or deleting a token does not sign you out of the browser or of MCP, and signing out does not touch the token. |
| **No super user** | The super user is for administering the tenant and does not get a token. Use a normal account. |

## Regenerate and delete

- **Regenerate** makes a new token and the old one stops working **at once**. Anything using the old one fails until you give it the new one.
- **Delete** removes the token and nothing replaces it. You are asked to type `delete` to confirm.

:::warning A password change does not end the token
Changing or resetting your password leaves the token working. If you think a token has leaked, regenerate or delete it yourself. What does stop a token is the account: a deactivated or deleted person is refused, and reactivating the person makes their existing token work again.
:::

## Use it

Send it as a bearer token:

```bash
curl -H "Authorization: Bearer $ETLFUNNEL_TOKEN" https://your-studio.example.com/public/v1/me
```

A missing, wrong or replaced token is a plain `401`. The token is never written to the server's access log. See the [Public API](./public-api) for everything a token can do.

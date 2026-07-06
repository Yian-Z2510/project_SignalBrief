# Follow Builders Digest

Daily Chinese AI Builders Digest delivered by GitHub Actions.

The workflow fetches the public Follow Builders central feeds, turns them into a structured Chinese briefing, and sends the email through Resend.

## Setup

1. In this GitHub repo, open `Settings` -> `Secrets and variables` -> `Actions`.
2. Add a repository secret named `RESEND_API_KEY`.
3. Put your Resend API key as the value.
4. Open `Actions` -> `Send AI Builders Digest` -> `Run workflow` to test manually.

## Scheduling

GitHub Actions scheduled workflows can be delayed, so this workflow is designed
to be triggered by an external scheduler via `workflow_dispatch`.

Configure an external cron service, such as cron-job.org, to send a daily POST
request at your preferred local time.

URL:

```text
https://api.github.com/repos/Yian-Z2510/Follow_Builders_Digest/actions/workflows/send-digest.yml/dispatches
```

Headers:

```text
Accept: application/vnd.github+json
Authorization: Bearer <GITHUB_FINE_GRAINED_TOKEN>
X-GitHub-Api-Version: 2026-03-10
Content-Type: application/json
```

Body:

```json
{"ref":"main"}
```

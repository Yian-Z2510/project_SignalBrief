# Follow Builders Digest

Daily Chinese AI Builders Digest delivered by GitHub Actions.

The workflow fetches the public Follow Builders central feeds, turns them into a structured Chinese briefing, and sends the email through Resend.

## Setup

1. In this GitHub repo, open `Settings` -> `Secrets and variables` -> `Actions`.
2. Add a repository secret named `RESEND_API_KEY`.
3. Put your Resend API key as the value.
4. Open `Actions` -> `Send AI Builders Digest` -> `Run workflow` to test manually.

The scheduled workflow runs daily at about 14:20 Europe/Dublin.

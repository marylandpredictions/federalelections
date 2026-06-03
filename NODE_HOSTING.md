# Running Federal Elections Analysis on a Node host

`server.mjs` is the production server. It serves the static pages and keeps the API routes live:

- `/api/live-results`
- `/api/live-results/race?id=...`
- `/api/contact`

This matters for live results because a static host can only update after GitHub Actions commits new JSON. A Node host can fetch normalized live results through the server cache about every 15 seconds.

## Required settings

Use Node 22 or newer.

Start command:

```bash
npm start
```

Environment variables:

```bash
HOST=0.0.0.0
PORT=<provided by host>
CONTACT_TO=federalelectionsanalysis@gmail.com
CONTACT_FROM=federalelectionsanalysis@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=federalelectionsanalysis@gmail.com
SMTP_PASS=<gmail app password>
```

Most hosts set `PORT` automatically. Do not hard-code it in the host dashboard unless the host tells you to.

## Render setup

The repo includes `render.yaml`, so the fastest setup is:

1. Push this repo to GitHub.
2. In Render, choose `New` then `Blueprint`.
3. Connect the GitHub repo.
4. Let Render read `render.yaml`.
5. Add secret env vars that are not committed:
   - `SMTP_USER`
   - `SMTP_PASS`
6. Deploy.

Render will run `npm install` and `npm start`.

## Generic Node host setup

For any Node host:

1. Connect the GitHub repo.
2. Set Node version to `22`.
3. Set build command to `npm install`.
4. Set start command to `npm start`.
5. Add the environment variables above.
6. Point the domain DNS to the host according to the host's instructions.

## Local smoke test

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/api/live-results
```

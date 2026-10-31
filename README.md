# Cloudflare Worker image upload with D1 + Turnstile

This project provides a Cloudflare Worker API that accepts a POST upload containing an image, verifies a Cloudflare Turnstile token, and stores the file in a D1 database.

## Features

- `GET /` renders a basic upload form with a Turnstile widget
- `POST /api/upload` accepts multipart form uploads with `image` and `cf-turnstile-response`
- `POST /api/submit` accepts JSON with `imageBase64` and `cfTurnstileResponse`
- Stores the uploaded image as a D1 `BLOB`

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create the database:
   ```bash
   npx wrangler d1 create mbtedge-service-db
   ```

3. Update the `database_id` in `wrangler.jsonc` with the created database ID.

4. Copy the environment file and add your Turnstile secret key:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

5. Start the Worker locally:
   ```bash
   npm run dev
   ```

6. Open:
   ```text
   http://localhost:8787/
   ```

## Example upload with curl

```bash
curl -X POST "http://localhost:8787/api/upload" \
  -F "name=Jane Doe" \
  -F "company=ACME" \
  -F "email=jane@example.com" \
  -F "notes=Need a few engineers" \
  -F "image=@/path/to/photo.png" \
  -F "cf-turnstile-response=TOKEN_FROM_TURNSTILE"
```

## Production setup

Set the Turnstile secret using Wrangler secrets:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Then deploy:

```bash
npm run deploy
```

## Notes

- The sample HTML form uses the test site key `1x00000000000000000000AA` for demonstration.
- Replace it with your actual Cloudflare Turnstile site key in production.
- You can inspect stored rows in D1 with:

```bash
npx wrangler d1 execute mbtedge-service-db --local --command "SELECT * FROM submissions;"
```

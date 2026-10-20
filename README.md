# WhatsApp Inbox

A WhatsApp Web-style inbox built with Next.js 16 for the WhatsApp Cloud API. Send messages, templates, and interactive buttons with a familiar UI.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgokapso%2Fwhatsapp-cloud-inbox&env=KAPSO_API_KEY&envDescription=Get%20your%20Kapso%20API%20key%20from%20app.kapso.ai&envLink=https%3A%2F%2Fapp.kapso.ai)

![WhatsApp Cloud Inbox](https://cdn.jsdelivr.net/gh/gokapso/whatsapp-cloud-inbox@main/assets/kapso-whatsapp-inbox.png)

## Features

- **Real-time messaging** - Optional Kapso webhooks push updates over server-sent events; adaptive polling is the fallback
- **Template messages** - Text, media and location headers, named or positional parameters, URL, coupon-code and OTP buttons, with a live preview
- **Interactive messages** - Reply buttons, list menus and CTA links, each with a live preview and WhatsApp's limits enforced
- **WhatsApp Flows** - Send published or draft flows and read the answers as a form-response card
- **Location requests** - Ask a contact to share their location and see the reply as a map card
- **Reactions** - React to customer messages with any emoji and see the contact's reactions on yours
- **Media support** - Send images, videos, documents, and audio
- **24-hour window enforcement** - Automatically restricts messaging outside WhatsApp's window
- **Optimistic sending** - Messages appear instantly, with retry and delete when WhatsApp rejects them
- **Readable errors** - WhatsApp error codes become plain explanations (e.g. 131047 switches the chat to templates)
- **Read receipts and typing** - Opening a chat marks it read and typing shows "typing…" (can be turned off in Settings)
- **Rich composer** - Multi-line input, Enter to send, per-chat drafts, paste or drop files, size and type checks before upload
- **WhatsApp-style UI** - Familiar interface with read receipts, timestamps, and message bubbles
- **Single sign-on** - OIDC, Google, Microsoft Entra ID, and GitHub via Auth.js, with domain/email allowlists
- **Mobile first** - Touch-sized controls, bottom-sheet dialogs, safe-area insets, and installable as a PWA
- **Container image** - Multi-arch image published to GitHub Container Registry

## Setup

### 1. Get Kapso credentials

1. Create account at [app.kapso.ai](https://app.kapso.ai)
2. Connect a WhatsApp number
3. Get your Kapso API key

### 2. Clone and install

```bash
git clone https://github.com/gokapso/whatsapp-cloud-inbox.git
cd whatsapp-cloud-inbox
npm install
```

### 3. Environment variables

Create `.env`:

```env
KAPSO_API_KEY=your_kapso_api_key
WHATSAPP_API_URL=https://api.kapso.ai/meta/whatsapp  # Optional: custom API endpoint

# Optional: only needed when your platform API is on a different host
KAPSO_API_BASE_URL=https://api.kapso.ai

# Optional: backwards-compatible single-number fallback
PHONE_NUMBER_ID=your_phone_number_id
WABA_ID=your_business_account_id
```

Requires Node.js 20.9 or newer.

### 4. Run

```bash
npm run dev
```

Open [http://localhost:4000](http://localhost:4000)

Open [http://localhost:4000/settings](http://localhost:4000/settings) to choose which WhatsApp numbers the inbox tracks. The app discovers `PHONE_NUMBER_ID` and `WABA_ID` values from Kapso using `KAPSO_API_KEY`, then stores the selected numbers in an HTTP-only cookie.

## Single sign-on

Every page and API route is protected by SSO through [Auth.js](https://authjs.dev). Configure one or more identity providers in `.env` (see `.env.example`); each provider appears as a button on `/login`.

| Provider | Variables | Callback URL |
| --- | --- | --- |
| Generic OIDC (Okta, Auth0, Keycloak, Authentik, …) | `AUTH_OIDC_ISSUER`, `AUTH_OIDC_ID`, `AUTH_OIDC_SECRET`, `AUTH_OIDC_NAME` | `/api/auth/callback/oidc` |
| Google | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GOOGLE_HOSTED_DOMAIN` | `/api/auth/callback/google` |
| Microsoft Entra ID | `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `/api/auth/callback/microsoft-entra-id` |
| GitHub | `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | `/api/auth/callback/github` |

- `AUTH_SECRET` is required in production (`openssl rand -base64 32`).
- `AUTH_URL` must be the public URL of the app when it runs behind a proxy or in a container; otherwise the OAuth callback points at the container's internal address.
- `AUTH_ALLOWED_DOMAINS` / `AUTH_ALLOWED_EMAILS` restrict who can sign in. Accounts the provider marks as unverified are always rejected.
- With no provider configured, the app stays open under `npm run dev` but is locked in production. `AUTH_DISABLED=true` turns SSO off explicitly.
- `/api/health` stays public for container health checks.

## Container image

Each push to `main` and each `v*` tag builds a `linux/amd64` + `linux/arm64` image and publishes it to GitHub Container Registry with provenance and an SBOM (`.github/workflows/container.yml`). Pull requests build the image without pushing it.

```bash
docker pull ghcr.io/angwdev/whatsapp-cloud-inbox:latest
docker run --env-file .env -p 4000:3000 ghcr.io/angwdev/whatsapp-cloud-inbox:latest
```

Or build and run it locally with `docker compose up --build`. Tags: `latest` (default branch), `main`, `sha-<commit>`, and `1.2.3` / `1.2` for release tags. The first publish creates a private package; make it public under the repository's **Packages** settings if you want anonymous pulls.

### Deploy behind Traefik

`docker-compose.traefik.yml` runs the published image behind [Traefik v3](https://doc.traefik.io/traefik/) with automatic Let's Encrypt certificates. The app publishes no ports; Traefik is the only entry point.

```bash
# .env: add INBOX_HOST and ACME_EMAIL next to your app variables
docker network create traefik

# Existing Traefik on the `traefik` network:
docker compose -f docker-compose.traefik.yml up -d

# Or start the bundled Traefik as well (binds ports 80/443):
docker compose -f docker-compose.traefik.yml --profile traefik up -d
```

The labels set up:

- HTTP → HTTPS redirect and a TLS router for `INBOX_HOST` using the `CERT_RESOLVER` resolver (default `letsencrypt`)
- HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies, and compression
- A rate limit (10/min, burst 20) on `/login` and `/api/auth/*`
- Traefik health checks against `/api/health`
- `AUTH_URL` set to `https://${INBOX_HOST}` so OAuth callbacks use the public URL

The file also has commented examples for an IP allowlist, serving under a path prefix, and wildcard certificates. Set `IMAGE_TAG` to pin a release (for example `1.2.3` or `sha-abc1234`). The app container runs read-only with `no-new-privileges`.

If you use your own Traefik, use v3.6 or newer with Docker Engine 29+. Older Traefik releases speak a Docker API version that Docker 29 rejects.

## Key Features

### Template Messages

Send WhatsApp-approved templates with dynamic parameters:
- **Header + Body + Button parameters** - Full template support
- **Named and positional parameters** - Automatic detection
- **Two-step flow** - Select template → Fill parameters → Send

### Interactive Messages

Create button messages without templates:
- **Header (optional)** + **Body (required)** + **Buttons (1-3)**
- Each button gets a unique ID and title (max 20 chars)
- Ideal for quick replies, confirmations, menu selections

### Location Requests

Ask the contact to share where they are ([Cloud API docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages)):
- **Body text (required, max 1024 chars)** with suggested presets and a live preview
- The contact sees a **Send location** button; the request bubble shows whether they answered and jumps to the reply
- Shared locations render as a map card (OpenStreetMap tiles) with name, address, coordinates, directions, and copy

### Reactions

React to messages the contact sent ([Cloud API docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/reaction-messages)):
- **Desktop** - hover a message and click the smiley; **touch** - long-press the message
- Six quick reactions plus a wider emoji grid; picking your current reaction again removes it
- Reactions show up immediately and roll back if WhatsApp rejects them
- Both sides' reactions appear as a chip under the message; removals by the contact clear it
- Only available inside the 24-hour window and for messages up to 30 days old, as the Cloud API requires

### Real-time updates (optional)

Without configuration the inbox polls: every 10s for the conversation list (30s in a background tab, which keeps notifications working) and every 10–30s for the open chat. The open chat also refetches as soon as the list reports new activity.

For instant updates, point a Kapso phone-number webhook at the inbox:

```bash
curl -X POST "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/$PHONE_NUMBER_ID/webhooks" \
  -H "X-API-Key: $KAPSO_API_KEY" -H "Content-Type: application/json" \
  -d '{"whatsapp_webhook":{"kind":"kapso","url":"https://inbox.example.com/api/webhooks/kapso","secret_key":"<random secret>",
       "events":["whatsapp.message.received","whatsapp.message.sent","whatsapp.message.delivered","whatsapp.message.read","whatsapp.message.failed","whatsapp.conversation.created","whatsapp.conversation.ended"]}}'
```

Then set `KAPSO_WEBHOOK_SECRET` to the same secret. The route checks each delivery's `X-Webhook-Signature` (HMAC-SHA256), ignores retried deliveries, accepts batched payloads, and fans events out to open tabs over `/api/events`. Only IDs reach the browser; each tab refetches the data itself. Polling slows to once a minute while the stream is live. The fan-out is in-process, so run a single replica (or add a shared broker) when using it.

### 24-Hour Window

Automatically enforces WhatsApp's messaging policy:
- **Within 24h** - Send regular messages freely; the header shows how long is left
- **Outside 24h** - Template-only mode with clear messaging
- **No inbound messages** - Guide users to send templates

### Message Types

- ✅ Text messages with WhatsApp formatting (*bold*, _italic_, ~strike~, `code`) and clickable links
- ✅ Images (with a full-size viewer), videos, audio and voice notes, documents, stickers
- ✅ Template messages (with all parameter types)
- ✅ Interactive reply buttons, list messages and CTA links, plus the contact's button and list replies
- ✅ WhatsApp Flows and their responses
- ✅ Shared contacts, orders, unsupported messages and system notices
- ✅ Loading earlier messages
- ✅ Location request messages and shared locations
- ✅ Reactions (send, change, remove, and receive)
- ✅ Failed message indicators

## Contributing

Issues and PRs welcome. Keep it simple.

## License

MIT

# Breakthrough Financial Wellness

A small full-stack voice recording app for money-belief reprogramming and financial wellness reflection. Users can create an account, record audio in the browser, save it to the server, sign back in later, and play saved recordings on an infinite loop until they pause or stop playback.

## Run locally

```bash
npm start
```

Open `http://localhost:4173`.

## Deploy free first

Use the Render blueprint in `render.yaml` for a no-cost online pilot. See `DEPLOY.md` for the exact steps and free-tier limitations.

## What is included

- Email/password signup and sign in
- Terms and conditions acceptance during signup
- Server-verified captcha challenge for auth and recovery forms
- Forgot-password flow with expiring reset codes
- Password hashing with Node `scrypt`
- HTTP-only session cookies
- Browser voice recording with `MediaRecorder`
- Per-user recording library
- Looping playback through native audio controls
- Server-side audio storage under `data/recordings`
- Brand styling based on `https://breakthroughfinancialwellness.com/`
- Progressive Web App support for browser access and home-screen installation on Android and iOS

## Deployment notes

For real wellness or therapy-adjacent use, deploy behind HTTPS and store recordings in a managed private object store such as S3, Cloudflare R2, Supabase Storage, or Azure Blob Storage. Add encryption at rest, audit logging, backups, retention controls, patient consent language, and HIPAA/BAA review where required.

Mobile installation requires HTTPS on a public domain. Android browsers can show the in-app install prompt when the PWA criteria are met. iPhone and iPad users can install the app from Safari with Add to Home Screen.

The local forgot-password flow returns a reset code in the browser for testing. In production, replace that development response with an email or SMS delivery provider.

The included captcha is a lightweight server-verified math challenge for the prototype. For public production traffic, replace it with a managed captcha provider such as Cloudflare Turnstile, hCaptcha, or reCAPTCHA.

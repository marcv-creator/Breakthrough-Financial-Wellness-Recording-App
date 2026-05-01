# Free Online Pilot Deployment

This app can be deployed as a free Render web service for a no-cost pilot.

## Best free-first path

Use Render Free Web Service:

- It gives the app a public HTTPS URL.
- HTTPS lets phones use the microphone and install the PWA.
- The included `render.yaml` already sets the build/start commands.

## Render steps

1. Create a GitHub repository for this project.
2. Upload/push these project files to the repository. Do not upload the local `data/` folder.
3. Go to Render and create a new Blueprint or Web Service from that GitHub repository.
4. Select the Free instance type.
5. Confirm these settings if Render asks:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
6. Deploy the service.
7. Open the Render HTTPS URL on a phone.

## Mobile access

Android:

- Open the Render URL in Chrome.
- Use the in-app Install prompt or Chrome menu > Add to Home screen.

iPhone/iPad:

- Open the Render URL in Safari.
- Tap Share.
- Tap Add to Home Screen.

## Free-tier limitations

Render free web services can spin down when idle, so the first visit after inactivity may take around a minute.

The current app stores accounts and recordings in local JSON/files under `data/`. On free Render web services, that local filesystem is temporary. Recordings/accounts can be lost on restart, redeploy, or spin-down.

For a real client pilot with durable recordings, move storage to a free backend such as Supabase before inviting many users.

## Password reset on free hosting

The deployment config uses:

```env
PASSWORD_RESET_DELIVERY=log
```

That means reset codes are written to Render server logs for the app owner to retrieve. For real users, connect an email/SMS provider and stop relying on logs.

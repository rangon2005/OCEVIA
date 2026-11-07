# OCEVIA — Render deployment package

This repository contains two Render services:

1. **ocevia-website** — static HTML frontend. No Python, no `requirements.txt`, and no Start Command.
2. **ocevia-tourmate** — Node.js chat service, deployed from the `tourmate/` directory.

## Recommended deployment: Render Blueprint

1. Upload the *contents* of this folder to the root of a GitHub repository (so `index.html` and `render.yaml` are at repository root).
2. In Render choose **New → Blueprint**, connect that repository, and apply the `render.yaml` blueprint.
3. Render creates both services. The static website is published from `.`. TourMate runs `npm install` and `npm start` from `tourmate/`.
4. Wait until both services are live. Open the `ocevia-tourmate` service URL; `/health` should return `{"ok":true,"service":"ocevia-tourmate"}`.
5. Open the `ocevia-website` URL. In the TourMate card, paste the TourMate service URL (the base URL, not `/health`) and click **Open TourMate**. The URL is saved in that browser.

## If creating services manually

### Main website (Static Site)
- Root Directory: leave blank
- Build Command: `echo "No build required"` (or leave blank)
- Publish Directory: `.`
- Start Command: not applicable; Static Sites do not use one.

### TourMate (Web Service)
- Root Directory: `tourmate`
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Node version: 18 or newer

## Live data and satellite note

The current `index.html` calls Open-Meteo forecast/marine/geocoding APIs and RainViewer radar directly from the visitor's browser. It does not contain a separate weather API backend, and the current uploaded source does **not** include a satellite imagery/API integration. The RainViewer layer is weather radar, not satellite imagery. Do not create a Python service or add a fake `requirements.txt` for these features.

## TourMate hosting limitation

When hosted on Render, TourMate is an internet-accessible chat service; it is not an offline, same-hotspot-only chat. The original local hotspot mode can still be run manually with `node tourmate-server.js` on a device on the shared Wi-Fi/hotspot. Messages are in memory and are lost when the process restarts; the chat has no authentication or end-to-end encryption, so do not use it for sensitive information.

## Gemini

The website's optional Gemini feature asks each visitor to enter their own API key in the browser. Do not commit private API keys to GitHub.

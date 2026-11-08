# OCEVIA — 7-day AI travel weather + TourMate

Ocevia is served as one Node.js web app. The red TourMate button is part of the same website; it no longer opens a separate URL.

## Deploy online with Render
1. Push the complete repository contents to GitHub.
2. In Render, create a Blueprint from the repository and apply `render.yaml`.
3. Open the single Ocevia service URL. TourMate is available inside the page.

## Run Ocevia + TourMate offline on one Wi-Fi / phone hotspot
This lets nearby phones chat without mobile data or internet. One device must host the site.

### Laptop
1. Install Node.js 18 or newer.
2. Turn on the laptop's Wi-Fi hotspot, or connect all devices to the same Wi-Fi router.
3. In this project folder run:
   `node tourmate/tourmate-server.js`
4. On the other phones, join that hotspot/Wi-Fi and open the LAN address printed in the terminal, for example `http://192.168.x.x:3000`.
5. Tap the red **TOURMATE · CHAT NEARBY** button, enter a display name, and join.

### Android host
1. Install Node.js in Termux (from a trusted app source).
2. Copy this project folder to the Android host.
3. Turn on Android's Wi-Fi hotspot.
4. Run `node tourmate/tourmate-server.js` in Termux.
5. Other phones join that hotspot and open the IP address printed by Termux.

## Important offline limitations
- A website cannot silently scan all nearby phones or detect every phone with its hotspot enabled. Browsers and Android/iOS do not expose that permission to ordinary websites.
- TourMate lists people who have opened this same Ocevia host and joined its chat while connected to the same local Wi-Fi/hotspot.
- The host device must keep Node.js running. If it stops, nearby chat stops.
- Chat works locally without internet. Weather forecasts, map tiles, geocoding, and Gemini AI still require internet because their data comes from online services.
- Messages are temporary and kept in memory only. They are not end-to-end encrypted; do not share sensitive information. Use a password-protected hotspot.

## Seven-day forecast and AI advice
Ocevia fetches seven days of daily/hourly forecast data from Open-Meteo. The trip planner ranks the days using forecast rain, wind, temperature and weather codes, then suggests a departure day and approximate time. The optional Gemini key can produce a natural-language explanation; without a key, the built-in transparent rule-based adviser still works. Forecasts are uncertain, especially later in the week, so recheck before travelling and follow Bangladesh Meteorological Department warnings.

# OCEVIA: Bangladesh travel weather, AI guide, danger zones and TourMate

One Node.js web app, five pages (hash routes in a single `index.html`):

1. **Home** (`#home`): district / upazila selection and live weather details. The map shows live wind flow, rain radar and district temperatures, each switched on/off with its own icon button.
2. **Tour guide** (`#guide`): pick swimming, sunbathing, beach walk, photography, boating, hiking or family picnic. Ocevia ranks every matching place in Bangladesh with a 5-star rating from live weather and waves. Each place has *Why & risks* (Ocevia AI), *View weather* and *Route from me*.
3. **AI forecasting** (`#forecast`): 7 days with date, day, icon (sunny, half-day rain, all-day rain, thunderstorm...), temperature, rain, humidity, wind, a suitable / caution / avoid verdict and the best time of day, plus a clickable hourly forecast.
4. **Danger zone** (`#danger`): top 10 flood / erosion risk areas for the next 30 days.
5. **TourMate** (`#tourmate`): enter a name and a shared group code (max **20 travellers per group**), see everyone on a live map with small name labels, get a walking route to anyone, and tap **I'm lost** to alert the whole group (in-page alert bar, sound, vibration and a browser notification if allowed).

Navigation is a compact vertical icon rail on the right; there is no header bar any more. On phones, the map is prioritised and fills most of the first screen. Traveller names appear directly above their map pins. The header has a **⟳ refresh** button (next to dark/light mode) that reloads weather, wind, radar, district temperatures and the current page's data. Ocevia also auto-refreshes every 10 minutes.

## Run
`node tourmate/tourmate-server.js` (Node 18+), then open the printed address. On Render use `render.yaml` as before. To run the four-member room smoke test against a running server, use `OCEVIA_URL=http://127.0.0.1:3000 npm run test:tourmate` (Windows PowerShell: `$env:OCEVIA_URL='http://127.0.0.1:3000'; npm run test:tourmate`).

## TourMate connection fix
- TourMate uses the same-origin `/tm/join` + `/tm/events` + `/tm/loc` endpoints served by this Node app; it does not need a separate room URL.
- The live event stream now sends response headers immediately, disables proxy buffering, sends the current room roster as soon as it connects, and keeps the stream alive every 15 seconds. The browser retries if a stream closes.
- Deploy the complete repository as a **Node web service** using `render.yaml`. GitHub Pages/static hosting cannot run the room server. After pushing updates, redeploy the Render service and hard-refresh the site.
- Both travellers must open the same Ocevia site URL and enter the exact same group code. Each person must allow location permission for their pin to appear. The group map only displays locations shared by people who joined that room.

## Notes
- Weather, waves, flood-discharge, radar, geocoding and routing come from free online services (Open-Meteo, RainViewer, OSRM). They need internet.
- **Danger zone percentages are an Ocevia risk index**, not an official probability. They combine each area's long-term flood/erosion vulnerability (hand-set in `DZL` in `index.html`) with forecast river flow, rain, wind and waves. Rain/wave data reach about 16 days. Always follow FFWC, BWDB and BMD warnings.
- Spot coordinates for hills, historic sites and rivers are approximate; adjust them in `SP` in `index.html`.
- TourMate alerts reach phones only while Ocevia is open in the browser (background tabs usually work, a closed browser does not). Real push notifications would need a service worker and push server.
- **TourMate location needs https** (Render gives this) or `localhost`; phones on plain `http://192.168.x.x` will block location. Last shared positions remain in the room roster until the traveller taps *Leave group* or the seven-day stale-member cleanup runs. The server writes a best-effort state file; free hosting may reset ephemeral storage on restart.
- Gemini AI is built in (no settings screen). Set the free key once (see v8 notes below); without a key a built-in rule-based explanation is used.

## Layout and hosting notes (v7)
- Desktop: top bar with the animated Ocevia logo, icon navigation rail on the right. Mobile: bottom tab bar.
- The logo animates even when the operating system has "reduce motion" switched on (it is small and slow); other animations still respect that setting.
- TourMate needs the Node server. If the site itself is hosted on static hosting (GitHub Pages and similar), open TourMate and enter your Render/Node server address under "Server address". The server allows cross-site requests.
- Free hosts such as Render sleep when idle; the first TourMate check can take up to a minute, and the page says so while it waits.

## v8 changes
- **No header bar.** The logo, refresh and dark-mode buttons now float over the page, so the map uses the whole screen on desktop and mobile.
- **Phones:** choosing a location (dropdown, map tap, upazila marker, My location) zooms the map and then slides down to the weather automatically. A sticky **Back to map** button scrolls back up.
- **Zoom + border:** the chosen district / upazila is zoomed to and outlined (border polygons from OpenStreetMap Nominatim). If a border cannot be found, a dashed circle around the point is shown instead.
- **TourMate requires the Ocevia Node server.** If the website is on static hosting (such as GitHub Pages), enter the Render server address in TourMate's optional server-address setting. All group members must use the same server URL and group code.
- **Gemini AI is server-side only.** Set `GEMINI_API_KEY` in your Node host's secret Environment settings. Never put a real key in `index.html`, a public repository, or browser storage. Static hosting must call a secured server endpoint; this release does not support embedding a key in the page.

## v9 changes
- Animated "Ocevia" wordmark (Pacifico font, letters wave and shift colour) beside the small logo.
- Page buttons work again (a header rule had blocked clicks). On desktop they float without a column box.
- 🎯 button under wind / rain / temperature shows your location on the map. Mobile only: a ⌄ arrow at the bottom of the map slides down to the weather without tapping a location.
- TourMate: faster joining (connection mode is remembered, shorter wait, auto-rejoin when you reopen the page), every chat message shows the sender's name above the text, join / leave notices, and 📷 photo sending (photos are shrunk to a small JPEG; tap a photo to enlarge).

## Deploy on Render with the Gemini key
1. Push the project to GitHub. Never commit the API key.
2. Get a free key at https://aistudio.google.com/apikey.
3. Render > New > Blueprint (uses render.yaml) or New > Web Service: runtime Node, build `npm install`, start `node tourmate/tourmate-server.js`, health check `/health`.
4. In the service open Environment, add `GEMINI_API_KEY` = your key, save (Render redeploys).
5. Open `https://<service>.onrender.com/health`: it should show `"ai":true`.
Render Free services can sleep after 15 minutes without inbound traffic; the next request may take about a minute to wake. There is no public relay fallback in this release.


## TourMate notes (v12)
- TourMate uses the Ocevia Node server. If the page is on static hosting, enter the Render server address in the optional server-address setting so all members use the same server.
- A group holds up to 20 travellers (`TM_MAX_ROOM` environment variable changes this). Each browser has its own participant ID. Two different travellers may use the same display name without overwriting each other.
- The last known location and map photo stay in the group until the traveller leaves (or 7 days pass). They are saved to a small state file (`TM_STATE_FILE`, default in the system temp folder), so a server restart does not remove people.
- On Render Free, the service may sleep after 15 minutes without inbound traffic. The first request after sleep can take about a minute.
- A website can only read GPS while its page is open. When the page is closed or the phone is locked, friends see the last known spot.


## v13 reliability and free hosting notes
- `render.yaml` declares a Render **Free** Node web service for the combined Ocevia + TourMate server. Deploy this repository as a Render Blueprint. Render Free web services sleep after 15 minutes without inbound traffic, take about a minute to wake, and have an ephemeral filesystem; room state saved to the local state file can be lost on sleep/restart/redeploy. A persistent database is needed for durable room history. See https://render.com/docs/free.
- Room membership is keyed by a per-browser participant ID. The server no longer merges different offline members merely because they share a display name; this avoids a race where two people joining simultaneously with the same name could remove each other.
- Active dots are shown only for members whose heartbeat was received recently. Inactive members remain in the roster with their last shared coordinates until they explicitly leave (or the seven-day retention cleanup runs).
- Browser geolocation is foreground/browser controlled. A normal website cannot guarantee continuous GPS after its tab/browser is closed or the phone suspends it. The last location already received remains visible; live updates resume when the person returns and grants permission.
- Map starts focused on Bangladesh but can zoom out to the full world. Weather overlays are initially off; use the controls to enable wind, cloud/rain/thunder/fog, temperature, or My location. A global Open-Meteo grid covers ocean and land at overview zoom; tap any point outside Bangladesh to request its current conditions. Global data are a coarse overview, not a substitute for local marine warnings.

- Pulsing cyclone markers are added for current GDACS tropical-cyclone events worldwide; the feed refreshes every 10 minutes. Feed outages are shown as no update, not as a claim that there is no cyclone.
- The cloud haze layer is intentionally faint and only appears when zoomed out to keep place labels readable.

- At world zoom (zoom level 4 and below), Ocevia loads a coarse global weather grid for animated wind arrows, cloud/rain/storm/fog symbols, and temperature-coloured heat circles. At closer zoom, the detailed Bangladesh overlays are used. Global grid is coarse by design and should be treated as an overview, not street-level weather.

## v14 room, global weather and AI reliability
- When the page is served by the Ocevia Node server, TourMate and Gemini requests now always use that same origin, ignoring any stale manually saved server URL. This prevents requests being sent to an old Render service.
- Participant IDs are now unique per browser tab/session, so multiple people testing from separate tabs on one device do not overwrite one another. Room joins and location updates are covered by `npm run test:tourmate`.
- Friend profile cards and member lists show **Route to [name]**. The Tour Guide **Route from me** map is taller on desktop and mobile.
- Zoomed-out global wind, weather and temperature overlays use a denser ocean-and-land grid. Tapping anywhere outside Bangladesh requests current weather for that coordinate. Cyclone markers are no longer limited to Bangladesh.
- Gemini is called only through the Node server. Add `GEMINI_API_KEY` as a private host environment variable; `/health` reports `ai: true` when configured.

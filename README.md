# OCEVIA: Bangladesh travel weather, AI guide, danger zones and TourMate

One Node.js web app, five pages (hash routes in a single `index.html`):

1. **Home** (`#home`): district / upazila selection and live weather details. The map shows live wind flow, rain radar and district temperatures, each switched on/off with its own icon button.
2. **Tour guide** (`#guide`): pick swimming, sunbathing, beach walk, photography, boating, hiking or family picnic. Ocevia ranks every matching place in Bangladesh with a 5-star rating from live weather and waves. Each place has *Why & risks* (Ocevia AI), *View weather* and *Route from me*.
3. **AI forecasting** (`#forecast`): 7 days with date, day, icon (sunny, half-day rain, all-day rain, thunderstorm...), temperature, rain, humidity, wind, a suitable / caution / avoid verdict and the best time of day, plus a clickable hourly forecast.
4. **Danger zone** (`#danger`): top 10 flood / erosion risk areas for the next 30 days.
5. **TourMate** (`#tourmate`): enter a name and a shared group code (max **5 travellers per group**), see everyone on a live map with small name labels, get a walking route to anyone, and tap **I'm lost** to alert the whole group (in-page alert bar, sound, vibration and a browser notification if allowed).

Navigation is a compact vertical icon rail on the right; there is no header bar any more. On phones, the map is prioritised and fills most of the first screen. Traveller names appear directly above their map pins. The header has a **⟳ refresh** button (next to dark/light mode) that reloads weather, wind, radar, district temperatures and the current page's data. Ocevia also auto-refreshes every 10 minutes.

## Run
`node tourmate/tourmate-server.js` (Node 18+), then open the printed address. On Render use `render.yaml` as before.

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
- **TourMate location needs https** (Render gives this) or `localhost`; phones on plain `http://192.168.x.x` will block location. Positions live in server memory only, stay for up to 3 hours after a traveller goes offline (so a lost person's last position can still be found), and are deleted when they tap *Leave group*.
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
- **TourMate works without your own server.** If the Node server is not reachable (GitHub Pages, sleeping Render, any static host) TourMate switches to a **free public live relay** (ntfy.sh). Anyone who opens the site and enters the same group code joins that room (max 5). Use a long, hard-to-guess code: anyone who knows it can join. With the relay, chat is live only (no history) and a traveller shows as offline about 40 s after closing the page. The Node server, when online, is still used first.
- **Gemini AI built in, no AI settings box.** Option A (recommended): in Render add the environment variable `GEMINI_API_KEY` (free key from https://aistudio.google.com/apikey). The key stays on the server and the page calls `/ai`. Option B (static hosting): paste the key into `const GEMINI_KEY=''` near the top of the main script in `index.html`. That key is visible to visitors, so restrict it to your website in Google AI Studio.

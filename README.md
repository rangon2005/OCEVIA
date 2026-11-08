# OCEVIA: Bangladesh travel weather, AI guide, danger zones and TourMate

One Node.js web app, five pages (hash routes in a single `index.html`):

1. **Home** (`#home`): district / upazila selection and live weather details. The map shows live wind flow, rain radar and district temperatures, each switched on/off with its own icon button.
2. **Tour guide** (`#guide`): pick swimming, sunbathing, beach walk, photography, boating, hiking or family picnic. Ocevia ranks every matching place in Bangladesh with a 5-star rating from live weather and waves. Each place has *Why & risks* (Ocevia AI), *View weather* and *Route from me*.
3. **AI forecasting** (`#forecast`): 7 days with date, day, icon (sunny, half-day rain, all-day rain, thunderstorm...), temperature, rain, humidity, wind, a suitable / caution / avoid verdict and the best time of day, plus a clickable hourly forecast.
4. **Danger zone** (`#danger`): top 10 flood / erosion risk areas for the next 30 days.
5. **TourMate** (`#tourmate`): travellers enter a name and a shared group code, allow location, see each other on a live map, get a route to anyone, and can send an "I'm lost" alert.

## Run
`node tourmate/tourmate-server.js` (Node 18+), then open the printed address. On Render use `render.yaml` as before.

## Notes
- Weather, waves, flood-discharge, radar, geocoding and routing come from free online services (Open-Meteo, RainViewer, OSRM). They need internet.
- **Danger zone percentages are an Ocevia risk index**, not an official probability. They combine each area's long-term flood/erosion vulnerability (hand-set in `DZL` in `index.html`) with forecast river flow, rain, wind and waves. Rain/wave data reach about 16 days. Always follow FFWC, BWDB and BMD warnings.
- Spot coordinates for hills, historic sites and rivers are approximate; adjust them in `SP` in `index.html`.
- **TourMate location needs https** (Render gives this) or `localhost`; phones on plain `http://192.168.x.x` will block location. Positions live in server memory only, stay for up to 3 hours after a traveller goes offline (so a lost person's last position can still be found), and are deleted when they tap *Leave group*.
- Optional Gemini key (Tour guide page, AI settings) gives richer AI explanations; without it a built-in rule-based explanation is used.

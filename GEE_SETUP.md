# Historical Map Analysis: Google Earth Engine (free, non-commercial)

1. Register a Cloud project for Earth Engine: https://earthengine.google.com/noncommercial/
2. Cloud Console -> IAM -> Service Accounts -> create -> Keys -> Add key -> JSON.
3. Register that service account email in Earth Engine.
4. Render -> Environment:
   - GEE_SERVICE_ACCOUNT_JSON = whole JSON file content
   - GEE_PROJECT = your Cloud project id
5. Redeploy. Open /historical-map: the badge turns green.

Without these the page still compares real public imagery (EOX Sentinel-2 mosaics 2016-2024, NASA MODIS) but analysis is disabled.
Gemini check: open /ai/test on your Render site to see exactly why Gemini does or does not answer.

# TourMate on Firebase (no extra server)

1. https://console.firebase.google.com -> Add project (free Spark plan).
2. Build -> Realtime Database -> Create database -> start in locked mode.
3. Rules tab -> paste, then Publish:

```
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        ".write": true,
        ".validate": "$room.matches(/^[A-Z0-9]{3,12}$/)"
      }
    }
  }
}
```
Rooms cannot be listed; only people who know the group code can read one.

4. Copy the database URL (https://xxxx-default-rtdb.<region>.firebasedatabase.app).
5. Render -> Environment -> add FIREBASE_DB_URL = that URL -> redeploy.
   (Or paste it into window.FB_URL at the top of index.html.)

TourMate then says "runs on Firebase". Without the URL it falls back to the old Node room server.

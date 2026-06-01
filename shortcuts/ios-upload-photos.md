# Apple Shortcut: Upload Photos to CarPostClub

This recipe lets someone select photos or videos in the iPhone Photos app, or media files in macOS Finder, run a Shortcut, then finish the staged upload in the CarPostClub PWA with dealership, new/used, and live vehicle selects.

The signed shortcut file is included at `shortcuts/Upload to CarPostClub.shortcut`. The production app serves it as `Upload to CarPostClub Pick Vehicle.shortcut` at `https://carpostclub.com/shortcuts/upload-to-carpostclub-pick-vehicle.shortcut`. The download URL is public because the Shortcut contains no username, password, token, or other secret.

## PWA Setup

1. Sign in to the CarPostClub PWA and open `Photos Shortcut`.
2. Download or import `Upload to CarPostClub Pick Vehicle.shortcut`.
3. Share photos/videos to the Shortcut.
4. CarPostClub opens with the staged upload job.
5. Choose the dealership, new/used, and vehicle, then finish the upload.

Normal Photos uploads stage the shared media in a short-lived pending slot, then open CarPostClub to choose dealership, new/used, and a vehicle from live inventory picklists. The server does not attach staged media to a vehicle until the signed-in PWA user finishes the job, and uploaded media is attributed to that authenticated user.

On macOS, import the same Shortcut, select image/video files in Finder, then run `Upload to CarPostClub Pick Vehicle` from Quick Actions or Services. If Finder does not show it immediately, enable it in System Settings > Privacy & Security > Extensions > Finder.

## Shortcut Actions

1. Receive images, media, and files from the iPhone share sheet or macOS Finder Quick Actions.
2. Set `Selected Photos` to `Shortcut Input`.
3. `Get Contents of URL`.
   - URL: `https://carpostclub.com/api/shortcut/stage`
   - Method: `POST`
   - Headers:
     - `Accept`: `text/plain`
   - Request Body: `Form`
   - Form fields:
     - Text field `shortcutVersion`: `pick-vehicle-v8`
     - File field `photos`: `Shortcut Input`
4. Open URLs using the returned pending picker URL.

## Request Shape

The authenticated direct upload endpoint accepts any of these car fields:

```text
stockNumber
stock
vin
inventoryKey
manualInventoryId
query
q
vehicle
inventory
```

The server accepts files under any multipart field name, so `photos`, `media`, `file`, and the default `Shortcut Input` field all work.

## Helpful Checks

Create a token while signed in to the PWA, then verify a stock number:

```bash
curl -H "Authorization: Bearer TOKEN" "https://carpostclub.com/api/shortcut/vehicle?stockNumber=U6247A"
```

Fetch the same text labels the Shortcut shows:

```bash
curl -H "Authorization: Bearer TOKEN" "https://carpostclub.com/api/shortcut/inventory?format=labels"
```

Fetch the drill-down labels the shipped Shortcut uses:

```bash
curl -H "Authorization: Bearer TOKEN" "https://carpostclub.com/api/shortcut/dealerships?format=labels"

curl -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "dealership=O'Regan's Kia Halifax" \
  "https://carpostclub.com/api/shortcut/inventory-types?format=labels"

curl -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "dealership=O'Regan's Kia Halifax" \
  --data-urlencode "inventoryType=Used vehicles" \
  "https://carpostclub.com/api/shortcut/inventory?format=labels"
```

Stage photos from a computer the same way the shipped Shortcut does:

```bash
curl -H "Accept: text/plain" \
  -F "shortcutVersion=pick-vehicle-v8" \
  -F "photos=@front.jpg" \
  -F "photos=@interior.jpg" \
  "https://carpostclub.com/api/shortcut/stage"
```

Authenticated direct uploads still work for support/testing:

```bash
curl -H "Authorization: Bearer TOKEN" \
  -F "dealership=O'Regan's Kia Halifax" \
  -F "inventoryType=Used vehicles" \
  -F "inventory=U6247A - Used 2026 Kia Seltos X-Line AWD - Kia Halifax - Used" \
  -F "photos=@front.jpg" \
  -F "photos=@interior.jpg" \
  "https://carpostclub.com/api/shortcut/upload"
```

HTTP Basic auth, bearer username/password, and revocable bearer tokens still work for manual testing on `/api/shortcut/upload`, but the shipped Shortcut does not send credentials. It stages media on `/api/shortcut/stage`, then the PWA session gates the final save.

If a car is not in the picklist, the API still accepts manual `stockNumber`, `vin`, or `inventoryKey` values for support/testing calls.

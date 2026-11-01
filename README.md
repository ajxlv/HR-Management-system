# WRS Cleaning Photos

A phone web app for solar panel cleaners. The cleaner picks the client and date, fills four photo boxes
(Before, After, Bill, Wires), says whether there were defects, and submits. The photos go into that client's
OneDrive folder under a date folder, and one row per visit goes into a Google Sheet that HR keeps open.

```
OneDrive / Clients / <Client folder> / 2026-11-01 / Before_1.jpg, Before_2.jpg, After_1.jpg, Bill_1.jpg, Wires_1.jpg
Google Sheet / <Client tab> : Visit date | Submitted at | Cleaner | Before | After | Bill | Wires | Defects | Defect details | Checks | Folder
```

In the sheet, "Uploaded (n)" shows green and "Not uploaded" shows red. Defects "Yes" shows red.

## How the phone side works
- Before, After and Wires open the phone's own camera. The app stamps client, date, time and GPS on the photo.
  A photo older than 3 minutes is refused, so old gallery photos can't be passed off as new.
- Bill opens the camera or the gallery, with no location needed.
- Defects: Yes/No buttons are required; the text box is optional. Typing in it switches to Yes.
- Submit with a box empty asks once for confirmation, then shows "Not uploaded" in the sheet.
- Everything is queued on the phone first. With no signal, it sends when the signal returns.

## Checks the server does
- Short file names, numbered: `Before_1.jpg`, `Before_2.jpg`. A second visit the same day continues the numbering.
- A retried photo is not saved twice, and a visit is never written to the sheet twice.
- Date can be today or up to `MAX_BACK_DAYS` back, never in the future.
- The Checks column notes photos with no GPS, photos more than `MAX_DISTANCE_M` from the client's saved
  location, and photos taken on a different day from the date picked.

## Run it
Node 18 or newer, no packages to install.
```
cp .env.example .env
npm start          # http://localhost:3000, saves to ./storage
npm test
```
On a real phone the camera and GPS need HTTPS, so host it behind HTTPS.

## Clients
Edit `clients.json`. `folder` must match the existing OneDrive folder name exactly. `sheetTab` is the tab name
(created automatically if missing). `lat`/`lon` are optional and turn on the distance check.

## Connect OneDrive
Set `STORAGE=onedrive` and `ONEDRIVE_ROOT` (the folder that holds the client folders).
- **Microsoft 365 (business):** register an app in Microsoft Entra, add the Graph application permission
  `Files.ReadWrite.All`, have an admin grant consent, and set `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`
  and `MS_DRIVE_ID` (HR's drive id).
- **Personal OneDrive:** register an app for personal accounts, sign in once with the HR account to get a refresh
  token with `Files.ReadWrite offline_access`, and set `MS_CLIENT_ID` and `MS_REFRESH_TOKEN`. Leave `MS_TENANT_ID` empty.

## Connect the Google Sheet
Set `SHEET=google`. Create a Google Cloud service account with the Sheets API enabled, share the sheet with the
service account's email as Editor, and set `GOOGLE_SHEET_ID`, `GOOGLE_SA_EMAIL` and `GOOGLE_SA_KEY`.

## Not done yet
- No login: anyone with the link can upload. Add a PIN per cleaner before going live.
- OneDrive and Google Sheet connections are written but not yet tested against real accounts.
- Marathi/Hindi labels.

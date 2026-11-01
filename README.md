# WRS Cleaning Photos (HR management system)

A phone web app. The cleaner picks the client and date, takes **Before / After / Bill / Wires** photos, answers "any defects?" and presses **Submit**. Photos go to the client's folder in OneDrive. One row per visit goes to a Google Sheet for HR.

No dependencies. Node 18+.

## Try it on your computer (no accounts needed)

```bash
cp .env.example .env     # leave STORAGE=local and SHEET=csv
npm run seed             # makes the demo client folders
npm run demo             # fills demo/WRS_Cleaning_Status_demo.xlsx with sample visits
npm start                # http://localhost:3000
npm test                 # full flow test
```

Camera and GPS need HTTPS on a real phone. `localhost` counts as safe on the same computer only.
Photos land in `data/onedrive/Clients/<client>/<date>/`. The status sheet is the Excel file `data/WRS_Cleaning_Status.xlsx`.

## What HR gets

- OneDrive: `Clients/<client folder>/YYYY-MM-DD/Before_1.jpg, After_1.jpg, Bill_1.jpg, Wires_1.jpg`. A second visit the same day carries on the numbers. Nothing is overwritten.
- Excel sheet (`WRS_Cleaning_Status.xlsx`): one tab per client. Columns: Visit date, Submitted at (IST), Cleaner, Before, After, Bill, Wires, Defects, Defect details, Checks, Folder path. Boxes show green "Uploaded (n)" or red "Not uploaded". Checks lists photos with no GPS, more than 300 m from the site, or taken on a different day.

## Everyday jobs

| Job | Where |
|---|---|
| Add a client | Add a line to `server/clients.json` (`id`, `name`, exact OneDrive `folder`, optional `lat`/`lng`). **Create the folder in OneDrive first**. The app never creates client folders. |
| Change the photo boxes | `BOXES` in `server/config.js` (and add an icon in `public/app.js` if you like). |
| Change the words on screen | `T` at the top of `public/app.js`. |
| Change the cleaner's name / PIN | `CLEANER_NAME`, `CLEANER_PIN` in the environment. |
| Date window, GPS distance | `MAX_DAYS_BACK`, `GPS_MAX_DISTANCE_M`. |

## Where photos go: two ways to reach company OneDrive

**A. Easiest, no admin needed:** run the app on an HR office PC that already syncs OneDrive. Set `STORAGE=local` and `LOCAL_ROOT` to the OneDrive sync folder (for example `C:\\Users\\HR\\OneDrive - WRS`). Photos then sync to OneDrive by themselves. The PC must be switched on when the cleaner sends. Photos wait in the phone queue until then.

**B. Direct to Microsoft Graph:** needs an admin to approve an app registration. Steps below.

### B. Connect OneDrive through Microsoft Graph (Microsoft 365)

1. Azure portal, **App registrations**, **New registration** (single tenant).
2. **API permissions**: Microsoft Graph, **Application** permission `Files.ReadWrite.All`. Press **Grant admin consent**.
   (Broad access: it can touch every OneDrive in the company. Ask your admin to restrict it to one site or user, e.g. with `Files.SelectedOperations.Selected`, if they can.)
3. **Certificates & secrets**: create a client secret.
4. Put these in the environment: `STORAGE=onedrive`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, and `MS_USER` (the HR person's email whose OneDrive holds `Clients`) or `MS_DRIVE_ID`.
5. Set `ROOT_FOLDER` if the folder is not called `Clients`.

## Optional: HR downloads the Excel file

Set `REPORT_KEY` to a long secret. HR can then open `https://<your-link>/report.xlsx?key=<that secret>` to download the latest file. Do not keep the same file open in Excel on the server PC, because Excel locks it. The app retries, but the new rows only appear after Excel is closed. Download a copy instead.

## Optional: Google Sheet instead of Excel

1. Google Cloud console: create a project, enable **Google Sheets API**, create a **service account**, then **Keys**, **Add key**, JSON.
2. Open the Sheet, **Share**, add the service account's `client_email` as **Editor**.
3. Set `SHEET=google`, `SHEET_ID` (the long id in the sheet URL), `GOOGLE_CLIENT_EMAIL`, and `GOOGLE_PRIVATE_KEY` (the `private_key` from the JSON, keep the `\n`).

## Deploy (free)

The app needs HTTPS and a disk that survives restarts, because `state.json` stops duplicate photos and rows. That rules out serverless hosting and free tiers that sleep or wipe the disk.

**Cheapest: run it on an office PC and expose it with a free tunnel.**
1. Install Node 18+, copy this folder, fill `.env`, run `npm start`.
2. Give it a public HTTPS address with **Tailscale Funnel** (free, stable `*.ts.net` address, no domain needed) or **Cloudflare Tunnel** (free, needs a domain, about Rs 800 a year, or a random address that changes on restart).
3. Set `CLEANER_PIN`, `SESSION_SECRET` and `REPORT_KEY`.

The PC must be on when the cleaner sends. Photos wait safely on the phone until it is. Use an always-on PC if there is one.
If the company has an Azure subscription, an App Service with persistent storage is the paid alternative.
On the cleaner's phone: open the link in Chrome (Android) or Safari (iPhone) and choose **Add to Home Screen**.

## How it behaves with no signal

Submit saves everything inside the phone first, then sends photos in order, then the visit. "N items waiting for signal" shows until sent. Sending is retried when the signal returns and every 20 seconds while the app is open. **On iPhone the app must be open to send.** Photos retried after a drop are not saved twice, and a visit sent twice adds one row.

## Notes for phase 2 (AI photo checks)

`data/state.json` keeps every visit with each photo's box, file path, time, GPS and accuracy, and the final sheet row, so a later job can read it.

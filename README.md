# WRS Cleaning Photos (HR management system)

A phone web app. The cleaner picks the client and date, takes the photos (Before, After, one box per inverter, Challan, Bill), fills in a short checklist, gives an overall status and presses **Submit**. Photos go to the client's folder in OneDrive. One row per visit goes to a Google Sheet for HR.

No dependencies. Node 18+.

## Try it on your computer (no accounts needed)

```bash
cp .env.example .env     # leave STORAGE=local and SHEET=csv
npm run seed -- --create-missing --create-root   # makes a local test folder tree (data/onedrive/Clients/<client>)
npm run demo             # fills demo/WRS_Cleaning_Status_demo.xlsx with sample visits
npm start                # http://localhost:3000
npm test                 # full flow test
```

Camera and GPS need HTTPS on a real phone. `localhost` counts as safe on the same computer only.
Photos land in `data/onedrive/Clients/<client>/<date>/`. The status sheet is the Excel file `data/WRS_Cleaning_Status.xlsx`.

## See it working in one command

```bash
npm run demo:serve
```

Fills 7 sample visits and runs on http://localhost:3000. Cleaner PIN `1234`. HR dashboard at `/hr.html`, key `hr-demo`. Walkthrough: `docs/DEMO_SCRIPT.md`. What we still need to fill in: `docs/SETUP_CHECKLIST.md`. Screenshots: `docs/screens/`.

## Demo on Vercel (demo only, not for real use)

`api/index.js` + `vercel.json` run the whole app as one Vercel function, pre-filled with the sample visits. Vercel has no permanent disk, so everything is kept in temporary storage and is **re-created whenever the function restarts**. Anything the cleaner submits during the demo can disappear after a few minutes of inactivity. The real app must run on a PC or VM with a disk.

1. vercel.com, **Add New, Project**, import `ajxlv/hr-management-system`.
2. Framework preset **Other**. Leave Build Command empty. Production branch: `wrs-cleaning-photos` (Settings, Git).
3. Optional environment variables to replace the demo defaults: `CLEANER_PIN` (1234), `REPORT_KEY` (hr-demo), `SESSION_SECRET`.
4. Deploy. Open the link on a phone: camera and GPS work because Vercel gives HTTPS.

## The client list

The dropdown on the cleaner's phone, the OneDrive folders and the Google Sheet tabs all come from `server/clients.json`. Each client is just `id`, `name`, `folder` (the exact OneDrive folder name, the same as the name) and, only if known, `lat` and `lng`. There is no inverter count and no phone number in it.

**To load or update the list from HR's Excel or CSV file:**

```bash
npm run import:clients -- "AMC_start_end_date_data.xlsx" --dry-run
```

```bash
npm run import:clients -- "AMC_start_end_date_data.xlsx"
```

The first command only reports. It prints which sheet, heading row and column it used for the names, what it fixed by itself, and any problems. The second one writes `server/clients.json`. It **refuses to write if any check fails** and prints a table of row, client, problem and suggested fix.

What it does:
- Finds the names column itself (a heading like "Client", "Site name", or HR's "AMC site list above 1 Lakh"). Use `--column C` (a letter or the heading text) if it guesses wrong, and `--sheet Name` for another sheet.
- Rows with no name (for example the next contract year of the same site) are skipped.
- Removes extra spaces and a **trailing dot** (Windows and OneDrive drop a trailing dot from a folder name, so `Acron Plast Pvt. Ltd.` becomes `Acron Plast Pvt. Ltd`).
- Folder = name, unless the sheet has a **Folder** column. Coordinates are read from an optional **Location** column (`19.99, 73.78` or a Google Maps link) and checked to be in India.
- **Refuses:** characters Windows and OneDrive do not allow in a folder name (`" * : < > ? / \ |`), reserved names like CON, a name longer than 100 characters, and two names that are the same when case and spacing are ignored (they would share a folder and a sheet tab). Similar names such as "Samsonite" and "Samsonite ASHOKA,DHONGADE" are fine.
- **Ids never move.** A client already in the list keeps its id when HR re-sorts the sheet or adds rows. New clients get the next free number. A client missing from the sheet is refused (stored visits use its id) unless you add `--allow-remove`. `--replace-all` starts the numbering again from `c01` and is meant for the first import only.
- Nothing else from the sheet (phone numbers, vendor, amounts) is copied.

**Do the OneDrive folders exist?** The real folders already exist in OneDrive, and the app never creates client folders on its own. To check, run:

```bash
npm run seed
```

It looks in `LOCAL_ROOT/ROOT_FOLDER` and only **reports** which client folders are missing. It also flags a folder that exists with a slightly different spelling (case, spacing) and never creates a look-alike. To create the ones that really are missing:

```bash
npm run seed -- --create-missing
```

The root folder itself is never created unless you also pass `--create-root` (only for a local test folder), so a wrong `LOCAL_ROOT` cannot make a fake tree.

The tests and the demos use six made-up clients in `testlib/clients.fixture.json`, never the real list.

## The visit form

Everything below is defined in `server/form.js` (labels, boxes, checklist items, sheet columns).

**Photos.** Every box takes several photos, from the camera (big tap) or from the gallery (small button).
- **Before**, **After**, **Inverter 1 to N**, **Challan** (the signed cleaning receipt), **Bill**. At least one photo in every box.
- **The cleaner decides how many inverters there are.** The form starts with one Inverter box. The cleaner presses **+ Add another inverter** for each extra one (up to 12) and **Remove** for the last one if he added too many. Every box he adds needs a photo. Clients carry no inverter data. The count travels with the visit, and the sheet shows "3 of 3 uploaded" (or "2 of 3 uploaded", in red, if a photo is missing).
- Files in the date folder: `Before_1.jpg`, `After_2.jpg`, `Inverter1_1.jpg`, `Inverter2_1.jpg`, `Challan_1.jpg`, `Bill_1.jpg`. A second visit the same day carries on the numbers.

**Location (Before and After).** Phones often have camera location tagging off, and gallery photos may have lost theirs, so the app uses, in this order:
1. the location **inside the photo** (EXIF), with its capture time, if there is one;
2. otherwise the **phone's live location** at the moment of upload.

The source is stored per photo as `photo EXIF`, `phone at upload` or `none`, with whether it was a live camera shot or a gallery photo. A location is **verified** when it came from the photo, or from the phone during a live camera shot. A gallery photo with only the phone's location (or none) shows in the sheet's Checks column as "Location not verified" (amber). Distance from the site (300 m) and "taken on a different day" (EXIF date not the visit date) are still checked. There is no "photo must be fresh" rule any more.

**Checklist (all compulsory).**
- Electrical equipment, each **ON / OFF / N/A**: ACDB, Inverter, DCDB, Internet (the plant's monitoring/data logger being online), MCB, SPD, Earthing Trip. ON is the normal state.
- Signatures on the paper challan, **Yes / No**: customer, cleaning supervisor.
- Work done, **Yes / No**: session cleaning completed, solar panels washed with water, inverter room checked, earthing pit checked.
- "Before photos taken" and "After photos taken" are filled in automatically from the photos.
- **Overall status**: Completed / Partly completed / Not completed. Then the existing defects Yes/No and note.
- A **Set all to normal** button fills ON and Yes in one tap (the cleaner still changes anything that is not normal).

**Submit is blocked** until every box has a photo and every question is answered. A list at the top says exactly what is missing, and the page scrolls to the first missing item.

Labels are English only. They are in `server/form.js` and the `T` block at the top of `public/app.js`, so another language can be added later.

## What HR gets

- OneDrive: `Clients/<client folder>/YYYY-MM-DD/` with the files above. Nothing is overwritten.
- **Google Sheet** (see below): one row per visit with **28 columns**: Visit date, Submitted at (IST), Cleaner, Before, After, Inverters ("4 of 4 uploaded"), Challan, Bill, then the seven electrical items, the two signatures, the four work items, Before and After photos taken, Overall status, Defects, Defect details, Checks, Photo folder. A coloured band above the header groups them: **Photos | Electrical checklist | Signatures | Work done | Result**. ON, Yes and Uploaded are green. OFF, No and Not uploaded are red. N/A is grey. Inverters is red unless every inverter has a photo. Checks is amber unless it says OK.
- The **Overview** tab adds "Visits with any OFF item" and "Visits not completed".
- **Dashboard page** at `/hr.html` (needs `REPORT_KEY`): every visit with chips for missing photos, OFF items, missing signatures, not completed, defects and checks, filters, photo thumbnails and the Excel download.
- Every answer is also kept as structured data in `data/state.json` (not only in the sheet).
- The Excel file (`WRS_Cleaning_Status.xlsx`, used for the demo) has the same columns and colours.

## Everyday jobs

| Job | Where |
|---|---|
| Add or change clients | Edit HR's list and run `npm run import:clients -- list.xlsx` (see **The client list** below). The OneDrive folder must exist: the app never creates client folders. |
| Change the photo boxes or checklist | `server/form.js`. After changing the columns, run `npm run format:sheet` and start new client tabs (see the note under Google Sheet). |
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

## Google Sheet (HR's status view)

Already done outside the code: Google Cloud project, service account, JSON key, Sheets API on, and the sheet shared with the service account's email as Editor.

**1. Fill `.env`** (copy `.env.example` first if you have not):

```
SHEET=google
SHEET_ID=<the long id from the sheet's address>
GOOGLE_KEY_FILE=C:\keys\wrs-hr-key.json
LOGO_URL=<optional, see below>
```

Keep the key file outside the project folder. Key files are also ignored by git, but never paste the key into chat or commit it.

**2. Prove it works**

```bash
npm install
npm run check:google
```

It prints `OK: wrote to '<sheet name>'`, or the exact fix. For example "Sheet not shared with ...: open the sheet, press Share, add this email as Editor", "Sheets API not enabled: enable it here <link>", or "Wrong SHEET_ID". The app runs the same check when it starts, and keeps working if it fails: visits are saved and their rows wait in `data/state.json`, then are retried every minute and never written twice.

**3. See the formatted sheet without a phone**

```bash
npm run demo:google
```

Sends 3 sample visits for 2 demo clients (a complete one with all items ON, one with a missing Challan and Inverter 3 photo and no customer signature, one with OFF items, an unverified location and a defect) and prints the sheet link. These are made-up clients, so it adds two demo tabs to your real sheet: delete them afterwards.

**What the sheet looks like**
- **Overview** tab first: one row per client with last visit, visits this month, visits with missing photos, open defects (red when above 0) and a link to the client's tab. All formulas, so hand edits are counted.
- **One tab per client**, created on the first visit. Rows 1 to 3 are the banner (logo, "<Client>: Panel Cleaning Visits", photo folder and last-updated time). Row 4 is the header. Rows 1 to 4 are frozen. Visits start at row 5. Dates are real dates, so HR can sort and filter. Green "Uploaded (n)", red "Not uploaded", red or green Defects, amber Checks, light banding, thin borders and a filter on the header.

Colours, columns and widths are all in `server/sheets/layout.js`. After changing it, or if someone breaks the formatting, run:

```bash
npm run format:sheet
```

**If the sheet already has tabs from the earlier layout** (11 columns, with a Wires column), do not reuse them: the new layout has 28 columns, so old rows would sit under the wrong headers. Rename those tabs (for example add " (old)") or delete them. The app then creates fresh tabs on the next visit. `npm run format:sheet` only re-applies the look of tabs that already use the new columns.

The first three columns (date, submitted at, cleaner) are frozen, together with rows 1 to 5. The banner is split around that line because Google Sheets does not allow freezing columns through a merged cell.

**Photo folder as a link:** add `"folderUrl": "https://..."` to a client in `server/clients.json` (the folder's OneDrive web address). Without it the column shows plain text.

**Logo in the sheet (`LOGO_URL`)**: the sheet needs a public web address for the logo.
1. Upload `public/logo.png` to Google Drive, press Share, choose "Anyone with the link".
2. Copy the file id from its link (the part between `/d/` and `/view`).
3. Set `LOGO_URL=https://drive.google.com/thumbnail?id=<FILE_ID>&sz=w400`, then run `npm run format:sheet`.

A raw GitHub link works instead if the repo is public. With `LOGO_URL` empty the banner shows the text "WRS Energy".

## Test on your phone (free, no account)

Camera and GPS only work over https, so use a Cloudflare quick tunnel while testing.

```bash
winget install --id Cloudflare.cloudflared
```

Close and reopen the terminal, start the app (`npm start`), then in a second terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a link like `https://something-random.trycloudflare.com`. Open it on the phone, sign in with `CLEANER_PIN`, and use Add to Home Screen. **The link changes every time you restart the tunnel.** For go-live use Tailscale Funnel (stable link, free), see Deploy below.

Windows notes: `LOCAL_ROOT` can have backslashes and spaces, for example `LOCAL_ROOT=C:\Users\HR\OneDrive - WRS` (no quotes needed). `npm install` and `npm start` need only Node 18 or newer.

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

Submit saves everything inside the phone first, then sends photos in order, then the visit. "N items waiting for signal" shows until sent. On Android Chrome the phone sends by itself when signal returns, even if the app is closed (Background Sync). Elsewhere sending is retried every 20 seconds while the app is open. **On iPhone the app must be open to send.** Photos retried after a drop are not saved twice, and a visit sent twice adds one row.

## Notes for phase 2 (AI photo checks)

`data/state.json` keeps every visit with each photo's box, file path, time, GPS and accuracy, and the final sheet row, so a later job can read it.

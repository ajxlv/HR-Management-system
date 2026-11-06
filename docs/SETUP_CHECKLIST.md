# Setup checklist: what we fill in tomorrow

Everything below is a **detail**, not a build task. The app already runs without them using demo values.

| # | What we need | Who knows it | Where it goes | Demo value now |
|---|---|---|---|---|
| 1 | Real client list (HR's Excel file): site names. Folder = name. Locations optional | HR | `npm run import:clients -- file.xlsx` writes `server/clients.json` | the 53 sites from HR's AMC list |
| 2 | Name of the OneDrive folder that holds all client folders | HR | `ROOT_FOLDER` in `.env` | `Clients` |
| 3 | Which PC runs the app, and the path of its OneDrive sync folder | HR / IT | `LOCAL_ROOT` in `.env` (with `STORAGE=local`) | demo folder inside `data/` |
| 4 | Each vendor's name and their own PIN (4-8 digits, all different) | HR | `VENDORS=Name=PIN;Name=PIN` | `Ramesh=1234` (single `CLEANER_PIN`) |
| 5 | Installation date and AMC expiry of each client (typed by the company; optional) | HR | two extra columns in the client Excel, then `npm run import:clients` | sample dates on the made-up clients |
| 6 | HR dashboard key (a long password) | HR | `REPORT_KEY` | `hr-demo` |
| 7 | A long random text for sessions | us | `SESSION_SECRET` | demo value |
| 7b | Google sheet id, key file path, logo link | HR / you | `SHEET_ID`, `GOOGLE_KEY_FILE`, `LOGO_URL` in `.env` | demo sheet id |
| 8 | Free public HTTPS link (Tailscale Funnel or Cloudflare Tunnel) | IT | tunnel setup, see README | none yet |
| 9 | Allowed days back for the work date | HR | `MAX_DAYS_BACK` | 1 (today and yesterday) |
| 10 | "Too far from site" distance | HR | `GPS_MAX_DISTANCE_M` | 300 m |

## Decisions to take in the meeting

1. **Photos reach OneDrive through the HR PC's sync folder (simple, free) or through Microsoft's app registration (needs IT admin approval)?** We recommend the sync folder.
2. Which PC runs the app, and is it on during working hours?
3. Does HR want the Excel file, the dashboard page, or both? Both are ready.
4. Should old visits (more than a month) move into an archive tab/file?
5. Phase 2 (AI check on how clean the panels are): do we start collecting the photos now? We already store the structured records for it.

## Decided for the visit form

- Wires box: **removed**. English only. Overall status: **Completed / Partly completed / Not completed**. "Internet" means the plant's monitoring/data logger is online.
- Every box needs a photo and every checklist question needs an answer before Submit works.
- The **cleaner decides the number of inverters** for each visit (dashed + Add inverter box). Only **Inverter 1 is compulsory**. Clients have no inverter data.
- Earthing pit before and after photos are compulsory. ACDB means the MCB (ON / OFF); there is no separate MCB line. SPD is split into AC SPD and DC SPD. Internet is BLUE / OFF / N/A.
- The client signs on the phone (name in the corner, date and time stamped). If the client is away, the cleaner ticks "Client is not available" and writes why. The AMC expiry note appears right after the signature.
- Each vendor has their own PIN. The date is today or yesterday only.
- Postponed by HR for later: visit schedule, delay notification, vendor schedule with a remark, assigning projects to vendors.

## Still open

- Are all 53 OneDrive folders there with exactly the site names? Run `npm run seed` on the HR PC to see which are missing.
- Site locations (optional): add a Location column to HR's sheet and import again.
- Do the existing Google Sheet tabs hold real visits? If so they need to be renamed before the new layout starts (the columns changed).
- Marathi labels, if HR wants them later: someone who speaks Marathi should write the words for ON, OFF and the checklist.

# 5-minute demo

Start it: `npm run demo:serve`. It fills 7 sample visits and runs on http://localhost:3000.
Cleaner PIN **1234**. HR page http://localhost:3000/hr.html, key **hr-demo**.
Screenshots of every step are in `docs/screens/`.

1. **The problem (30 s).** Today: photos in WhatsApp, HR renames and files each one by hand.
2. **Cleaner's phone (2 min).**
   - Open the app. Enter PIN. Big text, one screen.
   - Pick client. Date is today. Take Before (twice), After, Bill. Tap YES for defects and type a note.
   - Choose a client with 4 or 6 inverters: the form shows one box per inverter. Press SUBMIT with things missing: a red list at the top says exactly what, and the page scrolls to the first one.
   - Add photos from the camera and from the gallery. Tap a photo to see its location badge. Press "Set all to normal", then change one item to OFF.
   - Point out the stamp on each photo: client, box, time, GPS.
3. **HR dashboard (2 min).**
   - The new visit is at the top: yellow "Missing: Inverter 5", red "OFF: MCB", red "No signature".
   - Click the red "Defects reported" tile: only visits with problems.
   - Open a visit: defect note, OneDrive folder path, photos. Click a photo to enlarge.
   - Click "Download Excel": one tab per client, colour-coded.
4. **Show OneDrive layout (30 s).** `Clients/<client>/<date>/Before_1.jpg, After_1.jpg ...`. Same-day second visit continues the numbers.
5. **What we need from HR tomorrow.** `docs/SETUP_CHECKLIST.md`.

## If asked

- **No signal on the roof?** Photos and the visit are saved on the phone and sent when signal returns. A banner shows "N items waiting for signal".
- **Can the cleaner cheat with an old photo?** Camera boxes refuse photos older than 3 minutes, and HR sees a flag when GPS is missing, far from the site, or the photo was taken on another day. It is a flag for review, not proof.
- **iPhone?** Works, but unsent photos only go out while the app is open.

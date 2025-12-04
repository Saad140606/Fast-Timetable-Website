# Fast Timetable — by Saad

A modern, real-time timetable web app built with **Next.js** that syncs class data from **Google Sheets** automatically. Students can search, save classes, and view a personalized schedule with zero friction.

## ✨ Features

- **Real-time Sync** — Automatic sync from Google Sheets GViz JSON endpoint (no manual refreshes)
- **Smart Search** — Find classes by section, teacher, subject, or classroom
- **Saved Classes** — Add & save your classes for quick access
- **Offline Support** — Cached data shown when offline with a notification
- **Pull-to-Refresh** — Mobile-friendly pull gesture to manually refresh
- **Auto-Refresh** — Timetable syncs every 60 seconds silently
- **Responsive Design** — Beautiful UI that works on desktop, tablet, and phone
- **Tabs** — Organized sections: Timetable, Events, Teachers

## 🚀 Quick Start

```powershell
cd "fast-timetable-by-saad"
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## 🏗 Architecture

### Data Flow
1. **Frontend** requests metadata from a config endpoint (e.g., `server-timetable2.vercel.app/data`)
2. **Config Endpoint** responds with:
   ```json
   {
     "karachi": {
       "url": "https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:json&gid=",
       "codes": [
         {"name":"Monday","gid":"0"},
         {"name":"Tuesday","gid":"1"},
         ...
       ]
     }
   }
   ```
3. **Frontend** fetches each sheet page via Google's GViz JSON API (non-authenticated, public sheets)
4. **Parser** extracts class data (name, location, time) and sorts by time
5. **UI** displays classes grouped by day with search/filter options
6. **Cache** stores result in `localStorage` for offline access

### Key Files

- `lib/config.js` — Configurable endpoint for sheet metadata
- `lib/fetchSheets.js` — GViz JSON parser & fetcher
- `components/Timetable.js` — Main data flow, tabs, search, pull-to-refresh
- `components/Classes.js` — Class card display
- `components/SearchBar.js` — Reusable search input
- `components/AddClassesPopup.js` — Save/manage your classes
- `components/Notification.js` — Toast notifications
- `components/Events.js`, `components/Teachers.js` — Placeholder tabs

## 🔧 Configuration

Set the config URL via environment variable:

```powershell
$env:NEXT_PUBLIC_CONFIG_URL="https://your-server.com/timetable-config"
npm run dev
```

If not set, the app will use the local endpoint `./api/config` (served by this app) or the static `public/demo-config.json` file. To use a remote config server, set `NEXT_PUBLIC_CONFIG_URL`.

### Example Config Endpoint (Node/Express)
```javascript
app.get('/timetable-config', (req, res) => {
  res.json({
    karachi: {
      url: "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/gviz/query?tqx=out:json&gid=",
      codes: [
        {name: "Monday", gid: "0"},
        {name: "Tuesday", gid: "1"},
        {name: "Wednesday", gid: "2"},
        {name: "Thursday", gid: "3"},
        {name: "Friday", gid: "4"}
      ]
    }
  })
})
```

## 📚 How Google Sheets Integration Works

1. **Create a Google Sheet** with timetable data:
   - First row: Headers (e.g., "09:00-10:00", "10:00-11:00")
   - First column: Classroom/location names
   - Data cells: Class names (e.g., "BCS-3A COAL")

2. **Publish to Web** (File → Share → Publish to web)

3. **Get the Sheet ID** from the URL: `docs.google.com/spreadsheets/d/**SHEET_ID**/edit`

4. **Create the GViz URL**:
   ```
   https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/query?tqx=out:json&gid=0
   ```
   (Replace `gid=0` with the sheet tab number: 0 for Monday, 1 for Tuesday, etc.)

5. **Add to config endpoint** so the frontend can fetch it automatically.

## 📦 Tech Stack

- **Framework** — Next.js 13
- **Language** — React (Hooks)
- **Styling** — Vanilla CSS (modern dark theme, glassmorphism)
- **Data Source** — Google Sheets (via GViz JSON API)
- **Storage** — LocalStorage (caching & saved classes)

## 🎨 UI Design

**Color Palette:**
- Dark navy background (#0f172a, #0b1220)
- Vibrant violet accent (#7c3aed)
- Teal secondary (#06b6d4)
- Soft text (#e6eef8)

**Responsive:** 
- Desktop (1100px max-width)
- Mobile-first approach with Flexbox & CSS Grid
- Touch-friendly buttons and tabs

## 💾 LocalStorage Keys

- `ft_by_saad_all` — Cached full timetable (JSON)
- `ft_by_saad_saved` — Array of saved class names (JSON)

## 🔄 How Pull-to-Refresh Works

1. User touches and drags down from top of page
2. Visual indicator shows pull distance
3. When distance > 80px, a checkmark appears
4. Release triggers a fresh data fetch
5. Notification confirms: "✓ Timetable updated"

## 🚨 Error Handling & Offline

- **Network Error**: Shows cached data + notification "⚠ Showing cached data (offline)"
- **No Cache**: Shows error notification "✗ Network error & no cache"
- **Auto-Retry**: App retries every 60 seconds silently in the background

## 📱 Mobile Optimization

- Touch gestures (pull-to-refresh)
- Responsive layout (grid to single-column on mobile)
- Keyboard-friendly inputs
- ARIA labels for accessibility

## 🌐 Deployment

### Vercel (Recommended)
```powershell
npm install -g vercel
vercel
```

### Manual Hosting
```powershell
npm run build
npm start
```

Then deploy the `.next/` folder to any Node host.

### Environment Variables (on Vercel/host)
Add `NEXT_PUBLIC_CONFIG_URL` to your platform's env secrets.

## 🛠 Development Tips

- **Debug**: Open browser DevTools → Console to see fetch logs
- **Test Offline**: DevTools → Network → Offline mode
- **Local Config**: Point `NEXT_PUBLIC_CONFIG_URL` to a local JSON file or use `public/demo-config.json`

## 📝 Notes & Caveats

- Google Sheets must be **public** (published to web) for GViz to work
- GViz JSON API is read-only (no editing back to sheets)
- Sync interval is 60 seconds (configurable in code)
- Pull-to-refresh only works on mobile browsers with touch support

## 🎯 Future Enhancements

- [ ] Add events data syncing from a separate sheet
- [ ] Teacher directory with contact info
- [ ] Dark/Light mode toggle
- [ ] Calendar view
- [ ] Push notifications for class changes
- [ ] Admin dashboard to manage config

## 📄 License

This project is proprietary software owned and authored by Syed Saad Najam.

All rights reserved. The source code, documentation, and assets in this repository are not open source and may not be redistributed, copied, or published without explicit written permission from the author.

---

Created by Syed Saad Najam for students who need a better timetable experience.
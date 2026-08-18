# Reodite Schedules

One master weekly calendar for your whole friend group. Everyone drops in their UBC Workday
schedule export, picks a handle + avatar, and shares a single link — the app overlays every
schedule into one grid, merging shared course sections into single blocks that show everyone
who's in them.

**No backend.** Everything runs in the browser; group data travels compressed inside the
share link's URL hash, and persists locally in your browser.

## Features

- **Master calendar** — Google-Calendar-style week view of everyone's courses; each block shows
  course, time, building + room, and the avatars of everyone in that section.
- **Merged blocks** — friends in the same section share ONE block (their avatars stack on it).
- **Share links** — the whole group's schedules compress into a URL. Open a friend's link, add
  your schedule, copy the new link back to the chat. Newest data wins on merge; nothing is dropped.
- **Person filter** — click anyone in the crew panel to hide/show them on the grid.
- **Common free time** — green hatched bands where *everyone visible* is free (8 AM–8 PM, gaps ≥30 min).
- **Right now** — live panel of who's currently in class (and where) vs. free, reading-break aware.
- **Terms** — Fall/Spring detected automatically from the data; defaults to the current term.
- **Profiles** — emoji, colored initials, or an uploaded photo (photos stay on-device and in JSON
  exports; share links downgrade them to initials to keep URLs short).
- **JSON export/import** — full-fidelity backup path (includes photos), for when a link won't do.
- **Campus map** — the map button opens a pan/zoom map of UBC Vancouver (own page at `#map`, lazy
  loaded so the main page never downloads the geodata). Buildings with friends in class light up
  with avatar pins; clicking one reveals who's inside, their course, and room. **Live** mode tracks
  the current day and time; **Free** mode has a big time slider + day rail to scrub the whole week.
  Building shapes come from [Reodite/ubc-unified-data](https://github.com/Reodite/ubc-unified-data);
  regenerate `public/map/ubcv-campus.json` with `npm run build:map-data`.

## How to add your schedule

1. In Workday: **Academics → Registration & Courses → View Saved Schedule**, then export to
   Excel (the `.xlsx` download).
2. Drop the file on Reodite Schedules, pick a handle + avatar.
3. **Copy share link** → paste it in the group chat. Friends open it, add theirs, and re-share.

## Development

```sh
npm install
npm run dev        # local dev server
npm run test       # vitest unit tests (parser, share-link, merge, calendar logic)
npm run build      # type-check + production build to dist/
node e2e/smoke.mjs # end-to-end smoke test (needs `npm run dev` running + Edge installed)
```

The `examples/` folder contains sample Workday registration exports (`.xlsx`) used as test fixtures.

## Deploying (GitHub Pages)

The repo ships with `.github/workflows/deploy.yml`, which builds and publishes on every push
to `main`. One-time setup:

1. Create a GitHub repo named **`ScheduleSharer`**.
   (If you pick another name, change `base` in `vite.config.ts` to `'/<repo-name>/'`.)
2. ```sh
   git init
   git add -A
   git commit -m "ScheduleSharer"
   git remote add origin https://github.com/<you>/ScheduleSharer.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Source: GitHub Actions**.
4. Your app is live at `https://<you>.github.io/ScheduleSharer/` — bookmark it and share away.

## Architecture notes

- `src/parse/` — hand-rolled `.xlsx` reader (fflate unzip + fast-xml-parser) tuned to Workday's
  export quirks: bogus `<dimension>`, omitted empty cells, Excel serial dates, multi-pattern
  meeting cells split around reading break.
- `src/state/` — React reducer store, localStorage persistence, lz-string share-link codec
  (tuple-packed), newest-wins merge keyed by person id → handle.
- `src/calendar/` — pure layout pipeline: expand → merge identical sections across people →
  greedy column assignment for overlaps; pixel-positioned blocks on a CSS grid week view.
- `src/features/` — term derivation, common-free-time intervals, who's-free-now.



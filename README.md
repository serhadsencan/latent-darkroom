# latent darkroom

A multi-page, browser-based viewer for a local photo library. It scans folders on
disk, generates thumbnails and reads EXIF.

The full-size JPEG embedded in Fuji RAF files is extracted directly, so RAW frames
appear instantly and already carry the camera's film simulation — no RAW decode.

## Pages

| Page | Route | What it does |
|---|---|---|
| Gallery | `/` | Justified, virtualised grid; folder/year/body/lens/film-sim facets, search, rating |
| Map | `/map` | Shows photos with GPS EXIF as clusters |

Filters are shared between the two: pick a folder in the gallery and the map shows
that folder as well.

### Assigning locations

Most Fuji bodies do not record location, and phone pairing can drop out mid-trip.
The **assign location** button on the map offers two ways to fix that:

- **Pick frames individually** — turn on **selection** in the gallery and click
  frames (shift for a range, "select listed" for the whole filter). The selection
  carries across pages: switch to the map, click a point, and only your picks are
  updated. The sidebar's **Location → Unlocated** filter lists exactly the frames
  that need one.
- **A whole folder** — choose a folder (or everything unlocated) as the target,
  click a point on the map, and every unlocated frame in it is updated.
- **Derive from time** — estimates an unlocated frame from the nearest located
  frames in time. Between two anchors it interpolates by timestamp; with one, it
  reuses that anchor. A wider gap covers more frames but is less accurate — use
  **preview** to see how many would be affected before writing anything.

Assignments live in the `user_geo` table — **photo files are never touched**.
Rescanning does not clear them, and the undo section reverses everything. On the
map the pin border shows the source: plain for EXIF, blue for manual, dashed blue
for time-derived.

## Setup

```bash
npm install
cp .env.example .env
```

Set `PHOTO_ROOTS` in `.env` to your photo folder. Separate multiple folders with
`:` (not a comma, because macOS paths routinely contain spaces):

```
PHOTO_ROOTS=/Users/you/Pictures/Lightroom Saved Photos:/Volumes/SSD/Fujifilm
```

Then run the first scan:

```bash
npm run scan
```

## Running

```bash
npm run dev
```

The UI opens at http://localhost:5173 and the API at http://127.0.0.1:5174. The API
binds to `127.0.0.1` only — nothing else on the network can reach it.

Rescans can also be triggered from the refresh button in the UI. Scanning is
incremental: files whose size and mtime are unchanged are never touched. To rebuild
the index from scratch, run `npm run scan -- --force`.

## Interface

**daisyUI 5** (on Tailwind v4) with **lucide-react** icons. Buttons are icons plus
tooltips; text is used only where an icon would not carry the meaning.

Colours go through daisyUI's semantic tokens — `base-100` background, `base-200`
panels, `base-300` borders, `base-content` text, `primary` amber accent. No raw
colours in components, so retheming happens in one place.

## Theme

The **theme** button on the rail cycles dark → light → system; the choice is stored
in `localStorage` (`ld:theme`). With "system" selected the OS preference is followed
live.

Both themes are `@plugin 'daisyui/theme'` blocks in `index.css`, deliberately named
`dark` and `light` — `useTheme` writes those values straight onto `<html data-theme>`.
Adding a theme means adding one more block.

Two deliberate exceptions:

- **The lightbox stays dark in every theme** (via `data-theme="dark"`). Judging
  colour and exposure against a white surround is misleading.
- **The basemap follows the theme** — CARTO `dark_all` / `light_all`.

The theme is applied by a small script in `index.html` before React mounts, to avoid
a flash of the wrong colours.

## Logo

The emblem and favicon are generated from the source banner:

```bash
npm run logo Gemini_Generated_Image_961ap6961ap6961a.png -- --cx 0.4904 --cy 0.3763 --r 0.118
```

Those values were measured for the current banner. If the source image changes,
retune `--cx/--cy/--r` (the emblem's centre and radius as fractions of the image).
Output lands in `web/public/` and `LogoMark` reads it from there; if the file is
missing the UI quietly falls back to a text mark.

## Deleting

The **delete** button in the lightbox (or `Delete`) and the one in selection mode
move files to the **macOS Trash** via Finder, then drop them from the index and the
thumbnail cache. Finder is used rather than a plain move because only Finder records
the metadata that **Put Back** needs, which keeps the operation fully reversible.
Nothing is permanently deleted until you empty the Trash.

Deletion always goes through a confirmation dialog and only ever accepts an explicit
list of ids — deleting by filter is not supported, because one wrong filter would
send hundreds of frames away in a single click.

## Shortcuts

| Key | Action |
|---|---|
| `/` | Focus the search box |
| `←` `→` | Move through the lightbox |
| `0`–`5` | Rate (`0` clears) |
| `i` | Toggle the info panel |
| `Delete` | Move to Trash (asks first) |
| `esc` | Close the lightbox |

## Architecture

```
server/            Fastify API — filesystem, index, thumbnails
  src/config.ts    .env loading, roots, cache paths
  src/db.ts        node:sqlite schema (built in — no native dependency)
  src/indexer.ts   folder walk, EXIF extraction, incremental upsert
  src/raw.ts       RAF embedded-JPEG extractor + generic RAW preview
  src/fuji.ts      Fuji MakerNote → film simulation
  src/geo.ts       time-based location interpolation
  src/trash.ts     move to the macOS Trash via Finder
  src/thumbs.ts    sharp thumbnails with a disk cache
  src/routes.ts    HTTP endpoints
web/               Vite + React + Tailwind + daisyUI + react-router
  src/pages.tsx          page registry — route and rail button in one place
  src/pages/GalleryPage.tsx
  src/pages/MapPage.tsx  Leaflet (lazy-loaded)
  src/lib/justified.ts   row-based justified layout maths
  src/components/PhotoGrid.tsx  virtualised grid
```

**Adding a page:** write the component under `src/pages/`, add one line to the
`PAGES` array in `src/pages.tsx`. Route, rail button and lazy loading follow.

### Decisions

- **node:sqlite** instead of `better-sqlite3`. No native build, so a Node upgrade
  never leaves `node_modules` needing a rebuild.
- **Thumbnails on disk** — fixed `320 / 640 / 1280 / 2560` px buckets under
  `.cache/thumbs/<size>/<first 2 chars of id>/<id>.jpg`. The original never reaches
  the browser (except on download). Deleting the cache is safe; it regenerates.
- **Ratings and locations in separate tables** (`user_meta`, `user_geo`) so a
  rescan never destroys them.
- **Virtualisation** — the only thing keeping the DOM alive at 10k+ photos. Rows are
  virtualised, and because aspect ratios come from the index the layout never waits
  on measurement.
- **Map lazy-loaded** — Leaflet + markercluster is ~190 kB, split into its own chunk
  so it only downloads when the map page opens.

### Map and privacy

The basemap is CARTO's free raster layer (`TILE_URL` in `MapPage.tsx`). That means
**tile requests for the regions your photos are in go to CARTO** — not the photos
themselves, but the geography you look at. If that bothers you, point `TILE_URL` at
your own tile server or a local MBTiles source; it is one line.

### Known limits

- For RAW formats other than RAF (DNG, NEF, CR3…) only the small EXIF preview is
  attempted; there is no full RAW decode. Files without one show "no preview".
- Facet counts are computed over the whole library and do not narrow with the
  active filter.
- The filesystem is not watched — new photos need a rescan.
- Only files with GPS (from EXIF or assigned) appear on the map.

### Responsive behaviour

The shell is a fixed viewport — only inner panes scroll, the page never scrolls
sideways. The sidebar has a toggle in the top bar and collapses automatically below
900px (one-way: widening again does not reopen it, so a deliberate choice is not
overridden).

Top-bar controls hide progressively via **container queries**, not viewport
breakpoints, because the sidebar can take 240px away without the viewport changing
at all. In order of sacrifice: density slider, then sort + direction, then the photo
count.

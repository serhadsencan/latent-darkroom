# latent darkroom

A local photo library that runs in your browser. Points at folders on disk, never
copies anything, and gets out of the way.

Four pages: a **gallery** (justified grid, virtualised, facet filters), a **map** of
everything with GPS, a **grid** that lays your shots out as an Instagram profile
before you post them, and **groups** — named collections with notes.

Two things worth knowing about the Fuji handling: RAF files render instantly because
the full-size JPEG the camera already embedded is pulled straight out — no RAW
decode — and the film simulation is read from the MakerNote by hand, since no
off-the-shelf parser decodes Fuji's tables.

## Run it

```bash
npm install
cp .env.example .env      # set PHOTO_ROOTS to your photo folder
npm run scan
npm run dev
```

UI on :5173, API on :5174 (bound to localhost only).

## Shortcuts

| Key | |
|---|---|
| `/` | search |
| `←` `→` | move through the lightbox |
| `0`–`5` | rate |
| `i` | info panel |
| `Delete` | move to Trash (asks first) |
| `esc` | close |

## Things you should know

**Your files are never modified.** Ratings and assigned locations live in the app's
own SQLite tables, so a rescan can't wipe them and a wrong assignment is one click
to undo.

**Delete means the macOS Trash**, via Finder so "Put Back" works. Nothing is gone
until you empty it.

**Two things leave your machine**: map tiles (CARTO) and whatever you type into
place search (Nominatim). Not your photos — but the geography you look at and the
words you search. Both are one file each to swap: `web/src/lib/basemap.ts` and
`server/src/geocode.ts`.

**Missing locations can be filled two ways** — select frames and pick a place, or
derive them from timestamps when a neighbouring frame has GPS. Preview before
writing; the map shows where each location came from (solid border = EXIF, blue =
you, dashed = derived).

**The grid page is a planning tool, not an uploader.** Pick frames from the whole
library on the left, drag tiles to set the order you'll post in, click ✕ to drop one.
Three columns filling newest-first, like the real profile. Toggle between 4:5 and 1:1
(Instagram changed the profile thumbnail shape in 2025 and the rollout was uneven, so
both are there), and toggle the crop off to see exactly which edges get eaten.

Grids are **saved and named**, so you can keep one per trip and switch between them.
They live in the database, not the browser.

**Groups are the looser cousin** — a named collection with a note, for anything a
grid's posting order doesn't suit ("to print", "portfolio", "send to Ayşe"). The
search box drives the page: leave it empty to see the group, type to search the whole
library and click to add.

Photos also reach a group straight from the gallery: turn on selection, pick frames,
then hit the layers button next to delete. Adding to a brand-new group is one step —
name it in the dialog and it is created and filled together.

The page is deliberately cut off from the gallery's filters — a grid is planned
across everything, so the picker has its own search.

**The place box takes three kinds of input**: type to search, paste coordinates, or
paste a Google Maps link. If Google finds it faster, search there and bring the link
back — pulling Google's search results into an OSM map programmatically would break
their terms, but carrying one answer across by hand is exactly what the paste is for.

## Poking at it

- Adding a page: drop a component in `src/pages/`, add a line to `PAGES` in
  `src/pages.tsx`. Route, nav button and lazy loading follow.
- Regenerating the logo: `npm run logo <source.png>` (crop values are in the script).
- Rebuilding the index from scratch: `npm run scan -- --force`.

The interesting decisions are documented where they apply — why the thumbnail cache
is shaped the way it is, why Leaflet's CSS needs longer selectors than it should,
why the lightbox stays dark in light mode. Follow the comments.

## Rough edges

- Only RAF gets a real preview; other RAW formats fall back to the EXIF thumbnail.
- Facet counts are library-wide, they don't narrow with the active filter.
- No filesystem watching — new photos need a rescan.

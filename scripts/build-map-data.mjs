#!/usr/bin/env node
/**
 * Build the compact campus map dataset the /#map page fetches at runtime.
 *
 * Source: https://github.com/Reodite/ubc-unified-data (UBCV geospatial layers).
 * Output: public/map/ubcv-campus.json — buildings (code, name, outline),
 * roads and coastline for context, all quantized to a ~1 m integer grid so the
 * file stays small enough to fetch lazily (the raw geojson is ~1.3 MB).
 *
 * Usage:
 *   node scripts/build-map-data.mjs             # fetch from GitHub raw
 *   node scripts/build-map-data.mjs <repo-dir>  # read a local clone instead
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeBuildings } from './lib/mergeBuildings.mjs';

const RAW_BASE = 'https://raw.githubusercontent.com/Reodite/ubc-unified-data/main/data/geospatial/ubcv';
const SOURCES = {
  buildings: 'locations/geojson/ubcv_buildings.geojson',
  roads: 'transportation/geojson/ubcv_roads_simple.geojson',
  coast: 'context/geojson/ubcv_coastline.geojson',
};
/** classroom-building list — drives the "core campus" default framing */
const LEARNING_SPACES = 'data/learning-spaces/buildings.json';
const LEARNING_SPACES_RAW = `https://raw.githubusercontent.com/Reodite/ubc-unified-data/main/${LEARNING_SPACES}`;

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'map', 'ubcv-campus.json');

/** meters per degree at UBC's latitude (equirectangular is fine at campus scale) */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((49.26 * Math.PI) / 180);

/** Ramer–Douglas–Peucker on [x,y] point lists (meters). */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let maxI = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) {
        d = (px - x1) ** 2 + (py - y1) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
        d = (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2;
      }
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > sqTol) {
      keep[maxI] = 1;
      stack.push([first, maxI], [maxI, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

async function load(localDir, rel) {
  if (localDir) return JSON.parse(await readFile(join(localDir, 'data/geospatial/ubcv', rel), 'utf8'));
  const res = await fetch(`${RAW_BASE}/${rel}`);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${rel}`);
  return res.json();
}

function project([lon, lat]) {
  return [lon * M_PER_DEG_LON, -lat * M_PER_DEG_LAT]; // y grows downward (SVG)
}

/** geometry -> array of rings/lines, each an array of projected [x,y] */
function lines(geometry) {
  const { type, coordinates } = geometry;
  if (type === 'LineString') return [coordinates.map(project)];
  if (type === 'MultiLineString') return coordinates.map((l) => l.map(project));
  // polygons: outer rings only — holes are invisible at map scale
  if (type === 'Polygon') return [coordinates[0].map(project)];
  if (type === 'MultiPolygon') return coordinates.map((p) => p[0].map(project));
  return [];
}

function centroidOf(ring) {
  // area-weighted polygon centroid (shoelace); falls back to point average
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += cross;
    cx += (ring[i][0] + ring[i + 1][0]) * cross;
    cy += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  if (Math.abs(a) < 1e-6) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function ringAreaAbs(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a / 2);
}

async function loadLearningSpaces(localDir) {
  if (localDir) return JSON.parse(await readFile(join(localDir, LEARNING_SPACES), 'utf8'));
  const res = await fetch(LEARNING_SPACES_RAW);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${LEARNING_SPACES}`);
  return res.json();
}

/** Parse the existing generated BUILDINGS table back into [code, name] pairs. */
async function readPrevTable(tablePath) {
  try {
    const src = await readFile(tablePath, 'utf8');
    const rows = [];
    for (const m of src.matchAll(/\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g)) {
      rows.push([
        m[1].replace(/\\(.)/g, '$1'),
        m[2].replace(/\\(.)/g, '$1'),
      ]);
    }
    return rows;
  } catch {
    return [];
  }
}

async function main() {
  const localDir = process.argv[2];
  const [buildingsGj, roadsGj, coastGj, learningSpaces] = await Promise.all([
    load(localDir, SOURCES.buildings),
    load(localDir, SOURCES.roads),
    load(localDir, SOURCES.coast),
    loadLearningSpaces(localDir),
  ]);

  const buildings = [];
  for (const f of buildingsGj.features) {
    const { BLDG_CODE: code, NAME: name } = f.properties;
    if (!code || !f.geometry) continue;
    const rings = lines(f.geometry)
      .map((r) => simplify(r, 1))
      .filter((r) => r.length >= 4);
    if (rings.length === 0) continue;
    const biggest = rings.reduce((a, b) => (ringAreaAbs(b) > ringAreaAbs(a) ? b : a));
    buildings.push({ code, name: name || code, rings, centroid: centroidOf(biggest) });
  }

  const roads = roadsGj.features
    .flatMap((f) => (f.geometry ? lines(f.geometry) : []))
    .map((l) => simplify(l, 3))
    .filter((l) => l.length >= 2);

  const coast = coastGj.features
    .flatMap((f) => (f.geometry ? lines(f.geometry) : []))
    .map((l) => simplify(l, 5))
    .filter((l) => l.length >= 2);

  // quantize everything to a 1 m integer grid anchored at the data's min corner
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scan = (pts) =>
    pts.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
  buildings.forEach((b) => b.rings.forEach(scan));
  roads.forEach(scan);
  coast.forEach(scan);

  const q = (pts) => {
    const flat = [];
    let px = NaN;
    let py = NaN;
    for (const [x, y] of pts) {
      const ix = Math.round(x - minX);
      const iy = Math.round(y - minY);
      if (ix === px && iy === py) continue; // quantization can collapse neighbors
      flat.push(ix, iy);
      px = ix;
      py = iy;
    }
    return flat;
  };

  // default framing: bbox of the classroom buildings (the teaching core),
  // so the first paint isn't zoomed out to the whole peninsula
  const classroomCodes = new Set(learningSpaces.map((b) => b['Building Code']).filter(Boolean));
  let cMinX = Infinity;
  let cMinY = Infinity;
  let cMaxX = -Infinity;
  let cMaxY = -Infinity;
  for (const b of buildings) {
    if (!classroomCodes.has(b.code)) continue;
    for (const ring of b.rings) {
      for (const [x, y] of ring) {
        if (x < cMinX) cMinX = x;
        if (y < cMinY) cMinY = y;
        if (x > cMaxX) cMaxX = x;
        if (y > cMaxY) cMaxY = y;
      }
    }
  }

  const out = {
    src: 'https://github.com/Reodite/ubc-unified-data',
    generated: new Date().toISOString().slice(0, 10),
    // grid units are meters; [0,0] is the north-west corner, y grows south
    w: Math.round(maxX - minX),
    h: Math.round(maxY - minY),
    core: [
      Math.round(cMinX - minX),
      Math.round(cMinY - minY),
      Math.round(cMaxX - minX),
      Math.round(cMaxY - minY),
    ],
    buildings: buildings
      .map((b) => ({
        code: b.code,
        name: b.name,
        c: [Math.round(b.centroid[0] - minX), Math.round(b.centroid[1] - minY)],
        rings: b.rings.map(q).filter((r) => r.length >= 8),
      }))
      .filter((b) => b.rings.length > 0)
      .sort((a, b) => a.code.localeCompare(b.code)),
    roads: roads.map(q).filter((r) => r.length >= 4),
    coast: coast.map(q).filter((r) => r.length >= 4),
  };

  await mkdir(dirname(OUT), { recursive: true });
  const json = JSON.stringify(out);
  await writeFile(OUT, json);

  // also emit the static BUILDINGS table the share-link codec reads.
  // Append-only across runs so existing wire-format indices stay stable:
  // rows for existing codes keep their slot (verbatim, including any
  // frozen-as-of-the-first-encoding name), new rows append alphabetically.
  const tablePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'state', 'buildingTable.ts');
  const prev = await readPrevTable(tablePath);
  const next = [...out.buildings]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((b) => [b.code, b.name]);
  const merged = mergeBuildings(prev, next);
  const rows = merged.map(([code, name]) => `  [${JSON.stringify(code)}, ${JSON.stringify(name)}],`).join('\n');
  await writeFile(
    tablePath,
    `/**\n` +
      ` * Generated by scripts/build-map-data.mjs. Do not edit by hand.\n` +
      ` * Index = position. Regenerate with ` +
      '`npm run build:map-data`' +
      `.\n` +
      ` */\n` +
      `export const BUILDINGS: readonly (readonly [string, string])[] = [\n${rows}\n];\n`,
  );
  console.log(`wrote ${tablePath}: ${out.buildings.length} buildings`);
  console.log(
    `wrote ${OUT}: ${(json.length / 1024).toFixed(0)} KB, ` +
      `${out.buildings.length} buildings, ${out.roads.length} roads, ${out.coast.length} coast lines, ` +
      `grid ${out.w}x${out.h} m`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

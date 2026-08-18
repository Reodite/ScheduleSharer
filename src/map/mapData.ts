/**
 * Loader for the pre-baked campus map dataset (public/map/ubcv-campus.json,
 * regenerated with `npm run build:map-data` from Reodite/ubc-unified-data).
 * Fetched only from the map page so the main bundle never pays for it.
 */

export interface MapBuilding {
  code: string; // 'BUCH' — matches MeetingPattern.buildingCode
  name: string;
  /** centroid in grid meters */
  c: [number, number];
  /** outline rings as flat [x0,y0,x1,y1,...] in grid meters */
  rings: number[][];
}

export interface CampusMapData {
  src: string;
  /** grid extent in meters; [0,0] is the NW corner, y grows south */
  w: number;
  h: number;
  /** bbox of the classroom buildings — the default framing */
  core: [number, number, number, number];
  buildings: MapBuilding[];
  roads: number[][];
  coast: number[][];
}

let cached: Promise<CampusMapData> | null = null;

export function loadCampusMap(): Promise<CampusMapData> {
  if (!cached) {
    cached = fetch(`${import.meta.env.BASE_URL}map/ubcv-campus.json`).then((res) => {
      if (!res.ok) throw new Error(`campus map fetch failed (${res.status})`);
      return res.json() as Promise<CampusMapData>;
    });
    // a failed fetch shouldn't poison the cache — retry is possible
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** flat ring -> SVG path segment */
function ringToPath(ring: number[]): string {
  let d = `M${ring[0]} ${ring[1]}`;
  for (let i = 2; i < ring.length; i += 2) d += `L${ring[i]} ${ring[i + 1]}`;
  return d + 'Z';
}

export function buildingPath(b: MapBuilding): string {
  return b.rings.map(ringToPath).join('');
}

/** flat polyline list -> one combined SVG path (roads / coastline) */
export function linesPath(lines: number[][]): string {
  let d = '';
  for (const line of lines) {
    d += `M${line[0]} ${line[1]}`;
    for (let i = 2; i < line.length; i += 2) d += `L${line[i]} ${line[i + 1]}`;
  }
  return d;
}

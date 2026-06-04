import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export interface SheetRow {
  rowNum: number;
  /** column letter -> raw cell text (shared strings resolved; numbers as strings) */
  cells: Record<string, string>;
}

export interface SheetGrid {
  rows: SheetRow[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false, // Meeting Patterns cells rely on preserved '\n\n' separators
  parseTagValue: false,
  isArray: (name) => name === 'si' || name === 'r' || name === 'row' || name === 'c',
});

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Extract concatenated text from a <t> node or rich-text <r> runs. */
function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    // Check child elements before '#text': with trimValues=false, container
    // nodes like <si> carry inter-element whitespace as '#text'.
    if ('t' in obj) return textOf(obj['t']);
    if ('r' in obj) return textOf(obj['r']);
    if ('#text' in obj) return String(obj['#text']);
  }
  return '';
}

function parseSharedStrings(xml: string): string[] {
  const doc = parser.parse(xml);
  const sis = doc?.sst?.si ?? [];
  return (Array.isArray(sis) ? sis : [sis]).map(textOf);
}

/** 'G4' -> 'G'; 'AA12' -> 'AA' */
function colOf(ref: string): string {
  const m = ref.match(/^([A-Z]+)\d+$/);
  return m ? m[1] : '';
}

/**
 * Locate the first worksheet's zip path. Workday emits xl/worksheets/sheet1.xml,
 * but fall back to resolving workbook.xml -> rels if a future export moves it.
 */
function findSheetPath(files: Record<string, Uint8Array>): string {
  if (files['xl/worksheets/sheet1.xml']) return 'xl/worksheets/sheet1.xml';
  const candidate = Object.keys(files).find((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
  if (candidate) return candidate;
  throw new Error('No worksheet found in xlsx file');
}

/**
 * Read a Workday schedule .xlsx into a sparse grid.
 * NOTE: the sheet's <dimension> is wrong (A1:A1) and empty cells are omitted
 * entirely, so we scan every <row>/<c> and key cells by column letter.
 */
export function readXlsx(buf: ArrayBuffer): SheetGrid {
  const files = unzipSync(new Uint8Array(buf));

  const sharedStrings = files['xl/sharedStrings.xml']
    ? parseSharedStrings(decode(files['xl/sharedStrings.xml']))
    : [];

  const sheetXml = decode(files[findSheetPath(files)]);
  const doc = parser.parse(sheetXml);
  const xmlRows = doc?.worksheet?.sheetData?.row ?? [];

  const rows: SheetRow[] = [];
  for (const xmlRow of Array.isArray(xmlRows) ? xmlRows : [xmlRows]) {
    const rowNum = parseInt(xmlRow['@_r'] ?? '0', 10);
    const cells: Record<string, string> = {};
    const xmlCells = xmlRow.c ?? [];
    for (const c of Array.isArray(xmlCells) ? xmlCells : [xmlCells]) {
      const ref: string = c['@_r'] ?? '';
      const type: string = c['@_t'] ?? 'n';
      let value = '';
      if (type === 's') {
        const idx = parseInt(textOf(c.v), 10);
        value = sharedStrings[idx] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(c.is);
      } else {
        value = textOf(c.v);
      }
      if (ref && value !== '') cells[colOf(ref)] = value;
    }
    if (Object.keys(cells).length > 0) rows.push({ rowNum, cells });
  }
  rows.sort((a, b) => a.rowNum - b.rowNum);
  return { rows };
}

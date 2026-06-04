/**
 * End-to-end smoke test: drives the real app in headless Edge.
 * Simulates the full two-friend share-link round trip using the two
 * example Workday exports, and saves screenshots to e2e/shots/.
 *
 * Run: npm run dev (in another terminal), then: node e2e/smoke.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:5173/ScheduleSharer/';
const FALL = resolve('examples/View_Student_Registration_Saved_Schedule (1).xlsx');
const SPRING = resolve('examples/View_Student_Registration_Saved_Schedule.xlsx');
mkdirSync('e2e/shots', { recursive: true });

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

async function addPerson(page, file, handle, pickEmoji) {
  await page.setInputFiles('input[type=file][accept=".xlsx"]', file);
  await page.waitForSelector('.modal');
  await page.fill('.modal input[type=text]', handle);
  if (pickEmoji) {
    await page.click('.avatar-tabs button:has-text("emoji")');
    await page.click(`.avatar-grid button:has-text("${pickEmoji}")`);
  }
  await page.click('button:has-text("Add to calendar")');
  await page.waitForSelector('.modal', { state: 'detached' });
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });

// ---------- Person A: max uploads Fall, then alex uploads Spring ----------
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 920 } });
const pageA = await ctxA.newPage();
pageA.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
await pageA.goto(BASE);

check('hero shows on first visit', await pageA.locator('.hero').isVisible());
await pageA.screenshot({ path: 'e2e/shots/01-hero.png' });

await addPerson(pageA, FALL, 'max', '🦊');
await pageA.waitForSelector('.calendar');
check('calendar renders after first upload', await pageA.locator('.cal-block').count() > 0);
check('person appears in crew panel', await pageA.locator('.person').count() === 1);

await addPerson(pageA, SPRING, 'alex');
check('two people in crew panel', await pageA.locator('.person').count() === 2);
check('term switcher shows both terms', await pageA.locator('.terms__opt').count() === 2);

// default term (June 2026 -> upcoming Fall 2026); check Fall blocks (PHIL is max's)
check('fall term shows Symbolic Logic', await pageA.locator('.cal-block:has-text("Symbolic Logic")').count() > 0);
await pageA.screenshot({ path: 'e2e/shots/02-fall.png' });

await pageA.click('.terms__opt:has-text("Spring 2027")');
check('spring term shows Research Methods', await pageA.locator('.cal-block:has-text("Research Methods")').count() > 0);
check('fall course absent in spring', await pageA.locator('.cal-block:has-text("Symbolic Logic")').count() === 0);
check('free-time bands render', await pageA.locator('.free-band').count() > 0);
await pageA.screenshot({ path: 'e2e/shots/03-spring.png' });

// block detail popover
await pageA.click('.cal-block:has-text("Research Methods")');
check('detail shows course title', await pageA.locator('.detail__title:has-text("Research Methods")').isVisible());
check('detail lists instructor', await pageA.locator('.detail__row:has-text("Kelsey Allen")').count() > 0);
check('detail shows ONE weekly meets line', (await pageA.locator('.detail__row .mono').count()) === 1);
await pageA.screenshot({ path: 'e2e/shots/04-detail.png' });
await pageA.click('button:has-text("Close")');

// person filter: hide alex -> spring goes empty (alex owns all spring courses)
await pageA.click('.person:has-text("alex") .person__main');
check('hiding alex empties spring blocks', await pageA.locator('.cal-block').count() === 0);
await pageA.click('.person:has-text("alex") .person__main');

// share link
await pageA.click('button:has-text("Copy share link")');
await pageA.waitForFunction(() => location.hash.startsWith('#d='));
const hash = await pageA.evaluate(() => location.hash);
check('share hash generated', hash.length > 50);
console.log(`  link length: ${(BASE + hash).length} chars`);

// ---------- Person B: fresh browser opens the link ----------
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 920 } });
const pageB = await ctxB.newPage();
pageB.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });
await pageB.goto(BASE + hash);
await pageB.waitForSelector('.calendar');
check('link import: both people arrive', await pageB.locator('.person').count() === 2);
check('link import toast fires', await pageB.locator('.toast').first().isVisible());

// merged block: B uploads the SAME spring file as casey -> one block, two chips
await pageB.click('.terms__opt:has-text("Spring 2027")');
await addPerson(pageB, SPRING, 'casey', '🐼');
const cogsBlocks = pageB.locator('.cal-block:has-text("Research Methods")');
check('same section stays ONE merged block', (await cogsBlocks.count()) === 2); // Mon + Wed instances
check('merged block shows two avatar chips', (await cogsBlocks.first().locator('.chip').count()) === 2);
await pageB.screenshot({ path: 'e2e/shots/05-merged.png' });

// B re-shares; A opens -> casey arrives, max/alex intact
await pageB.click('button:has-text("Copy share link")');
await pageB.waitForFunction(() => location.hash.startsWith('#d='));
const hash2 = await pageB.evaluate(() => location.hash);
await pageA.goto(BASE + hash2);
await pageA.waitForSelector('.calendar');
check('round trip back to A: three people', await pageA.locator('.person').count() === 3);

// mobile layout
const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } });
const pageM = await ctxM.newPage();
await pageM.goto(BASE + hash2);
await pageM.waitForSelector('.calendar');
check('mobile: day tabs visible', await pageM.locator('.day-tabs').isVisible());
await pageM.click('.terms__opt:has-text("Spring")');
await pageM.click('.day-tabs button:has-text("Mon")');
await pageM.screenshot({ path: 'e2e/shots/06-mobile.png' });

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

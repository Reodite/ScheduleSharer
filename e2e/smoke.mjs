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
pageA.on('dialog', (d) => d.accept());
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

// default term (June 2026 -> upcoming Fall 2026); check Fall blocks (PHIL 222 is max's)
check('fall term shows PHIL 222', await pageA.locator('.cal-block:has-text("PHIL 222")').count() > 0);
await pageA.screenshot({ path: 'e2e/shots/02-fall.png' });

await pageA.click('.terms__opt:has-text("Spring 2027")');
check('spring term shows COGS 303', await pageA.locator('.cal-block:has-text("COGS 303")').count() > 0);
check('fall course absent in spring', await pageA.locator('.cal-block:has-text("PHIL 222")').count() === 0);
check('free-time bands render', await pageA.locator('.free-band').count() > 0);
await pageA.screenshot({ path: 'e2e/shots/03-spring.png' });

// block detail popover
await pageA.click('.cal-block:has-text("COGS 303")');
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
await pageA.waitForFunction(() => location.hash.startsWith('#e='));
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
const cogsBlocks = pageB.locator('.cal-block:has-text("COGS 303")');
check('same section stays ONE merged block', (await cogsBlocks.count()) === 2); // Mon + Wed instances
check('merged block shows two avatar chips', (await cogsBlocks.first().locator('.chip').count()) === 2);
await pageB.screenshot({ path: 'e2e/shots/05-merged.png' });

// B re-shares; A opens -> casey arrives, max/alex intact
await pageB.click('button:has-text("Copy share link")');
await pageB.waitForFunction(() => location.hash.startsWith('#e='));
const hash2 = await pageB.evaluate(() => location.hash);
await pageA.goto(BASE + hash2);
await pageA.waitForSelector('.calendar');
check('round trip back to A: three people', await pageA.locator('.person').count() === 3);

// ---------- schedule library ----------
check('schedule button shows default name', (await pageA.locator('.sched-btn').innerText()).includes('My schedule'));

// B's link had the same groupId -> updated in place, NOT cached as a duplicate
await pageA.click('.sched-btn');
await pageA.waitForSelector('.modal');
check('same-id link did not duplicate the schedule', (await pageA.locator('.sched-row').count()) === 1);
check('manager lists the crew', (await pageA.locator('.sched-row__names').innerText()).includes('max'));

// rename
await pageA.click('.sched-row__actions button[title="Rename"]');
await pageA.fill('.sched-row__rename', 'spring crew');
await pageA.keyboard.press('Enter');
check('rename sticks in the list', (await pageA.locator('.sched-row__name').innerText()).includes('spring crew'));
await pageA.click('button:has-text("Close")');
check('schedule button shows new name', (await pageA.locator('.sched-btn').innerText()).includes('spring crew'));
await pageA.screenshot({ path: 'e2e/shots/08-manager.png' });

// renamed title travels with the link
await pageA.click('button:has-text("Copy share link")');
await pageA.waitForFunction(() => location.hash.startsWith('#e='));
const hash3 = await pageA.evaluate(() => location.hash);
const ctxC = await browser.newContext({ viewport: { width: 1440, height: 920 } });
const pageC = await ctxC.newPage();
await pageC.goto(BASE + hash3);
await pageC.waitForSelector('.calendar');
check('link name arrives on a fresh device', (await pageC.locator('.sched-btn').innerText()).includes('spring crew'));
// fresh device: link cached as a NEW schedule alongside its empty default
await pageC.click('.sched-btn');
await pageC.waitForSelector('.modal');
check('fresh device caches link as new schedule', (await pageC.locator('.sched-row').count()) === 2);
await pageC.click('button:has-text("Close")');

// create, switch, delete
await pageA.click('.sched-btn');
await pageA.click('button:has-text("+ New schedule")');
check('new schedule starts empty (hero)', await pageA.locator('.hero').isVisible());
check('button shows the new schedule', (await pageA.locator('.sched-btn').innerText()).includes('Schedule 2'));
await pageA.click('.sched-btn');
check('manager lists two schedules', (await pageA.locator('.sched-row').count()) === 2);
await pageA.click('.sched-row:has-text("spring crew") .sched-row__main');
await pageA.waitForSelector('.calendar');
check('switching back restores the calendar', await pageA.locator('.cal-block').count() > 0);
await pageA.click('.sched-btn');
await pageA.click('.sched-row:has-text("Schedule 2") button[title="Delete from this device"]');
check('deleted schedule is gone', (await pageA.locator('.sched-row').count()) === 1);
await pageA.click('button:has-text("Close")');

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

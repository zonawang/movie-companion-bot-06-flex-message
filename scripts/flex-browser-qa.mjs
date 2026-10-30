import './flex-preview.mjs';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto(pathToFileURL(resolve('browser-results/flex-preview.html')).href);
 assert.equal(await page.locator('.bubble').count(), 10);
 assert.equal(await page.locator('.node-button.primary').first().evaluate(el => getComputedStyle(el).color), 'rgb(255, 254, 245)');
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
 await page.screenshot({ path: 'browser-results/flex-mobile.png', fullPage: true });
 await page.getByRole('button', { name: '完整場次', exact: true }).first().click();
 assert.match(await page.locator('.message').innerText(), /22:40/);
 await page.getByRole('button', { name: '回電影卡片' }).click();
 await page.getByRole('button', { name: '看更多電影' }).click();
 assert.equal(await page.locator('.bubble').count(), 2); assert.match(await page.locator('.bubble').first().innerText(), /凌晨的書店/);
 await page.getByRole('button', { name: '上一頁' }).click();
 await page.getByRole('button', { name: '電影介紹', exact: true }).first().click(); assert.match(await page.locator('.message').innerText(), /雨停之前/);
 await page.getByRole('button', { name: '回電影卡片' }).click();
 await page.setViewportSize({ width: 1440, height: 1100 });
 await page.screenshot({ path: 'browser-results/flex-desktop.png', fullPage: true });
 assert.deepEqual(errors, []); console.log('Flex fixture layout, paging and detail actions passed (browser preview, not LINE renderer).');
} finally { await browser.close(); }

// 逐館驗證原來源、官方與可巡檢的場次通。不大量擷取 Reelax；其備援只於個別使用者查詢時使用。
// 不呼叫 Gemini、不發 LINE、不讀寫票根。不可將入口、未公告、營運待核對算成有電影。
import assert from 'node:assert/strict';
import { CinemaSource, taipeiDateTime } from '../src/cinema.mjs';
import { cinemas } from '../src/cinema-registry.mjs';
const source = new CinemaSource({reelax:null}), queue = [...cinemas], results = [], date = taipeiDateTime().date;
async function worker() {
  while (queue.length) {
    const cinema = queue.shift(), result = await source.schedule({ cinema: cinema.id });
    const row = { id: cinema.id, name: cinema.name, county: cinema.county, status: result.status, date: result.date, versions: result.movies?.length || 0 };
    results.push(row); console.log(JSON.stringify(row));
  }
}
await Promise.all([worker(), worker()]);
const issues = results.filter(row => !['links_only','operation_notice','not_published','no_upcoming'].includes(row.status) && !(row.status === 'ok' && row.date === date && row.versions > 0));
console.log('SUMMARY',JSON.stringify({ total: results.length, structured: results.filter(row => row.status === 'ok').length, linksOnly: results.filter(row => row.status === 'links_only').length, issues }));
assert.equal(results.length,108); assert.equal(issues.length,0,'有來源未通過驗證，請查看 SUMMARY；勿宣稱全部有可讀場次');
console.log('PASS：已列出全名單的可巡檢來源狀態；入口、未公告與營運待核對不等於有電影。');

import test from 'node:test';
import assert from 'node:assert/strict';
import mappings from '../src/reelax-cinemas.json' with {type:'json'};
import twMappings from '../src/twshowtimes-cinemas.json' with {type:'json'};
import {cinemas,findCinema}from'../src/cinema-registry.mjs';
import {ReelaxSource,parseReelaxSchedule}from'../src/reelax.mjs';
import {parseTwshowtimesSchedule}from'../src/twshowtimes.mjs';
import {CinemaSource,formatCinemaSchedule}from'../src/cinema.mjs';
import {CinemaCards}from'../src/cinema-cards.mjs';
import {parseChinChinOfficial,parseTaoyuanOfficial,parseHualienOfficial,parseNeiweiOfficial}from'../src/official-cinemas.mjs';
const now=()=>new Date('2026-10-31T10:01:00Z');
const mapping=mappings.find(row=>row.cinemaId==='vieshow-xinyi');
function fixture(branch=mapping,date='2026-10-31',change={}){
 const row={movieName:'虛構測試片',theaterId:branch.theaterCode,theaterName:branch.name,date,time:'19:00',format:'IMAX',language:'英語',hallType:'$undefined',scrapedAt:'2026-10-31T00:00:00Z',seatsAvailable:20,...change};
 const data={theater:{id:branch.theaterCode,name:branch.name},initialDate:date,initialShowtimes:[row,{...row,time:'17:00'}]};
 return `<h1>${branch.name}</h1><script type="application/ld+json">${JSON.stringify({'@graph':[{'@type':'MovieTheater',name:branch.name,url:branch.url}]})}</script><script>self.__next_f.push(${JSON.stringify([1,'7:'+JSON.stringify(data)+'\n'])})</script>`;
}
const cc=()=>`<title>親親影城官網</title><footer>親親影城</footer><div class="showtime-item"><div class="theater-box"><div class="m_title">虛構測試片<span class="eng">Fixture</span></div><a href="product.php?_path=product_detail&id=1">詳情</a><div class="tab-pane" id="jump1_2026-10-31"><span class="dateDisplay">2026-10-31</span><div class="dateMovie">2D 英語</div><div class="seat-list"><li class="sky_word"><span class="float-left info">18:00</span></li><li class="sky_word"><span class="float-left info">19:20</span></li><li class="sky_word"><span class="float-left info">00:30</span></li></div></div></div></div>`;
test('all 108 registered branches have unique, exact provider IDs; all 64 alternative mappings point to registered branches',()=>{
 assert.equal(mappings.length,cinemas.length);assert.equal(new Set(mappings.map(row=>row.cinemaId)).size,108);
 for(const branch of cinemas){const m=mappings.find(row=>row.cinemaId===branch.id);assert.equal(m.theaterCode,branch.theaterCode||branch.directoryTheaterCode);const parsed=parseReelaxSchedule(fixture(m),branch.id,'2026-10-31');assert.equal(parsed.movies[0].title,'虛構測試片');}
 assert.equal(twMappings.length,64);assert.equal(new Set(twMappings.map(row=>row.cinemaId)).size,64);assert.ok(twMappings.every(row=>cinemas.some(cinema=>cinema.id===row.cinemaId)));
});
test('public JSON parsing rejects mismatched identity, dates and times without executing scripts or trusting seat data',()=>{
 const raw=fixture(),parsed=parseReelaxSchedule(raw,mapping.cinemaId,'2026-10-31');assert.equal(parsed.movies[0].version,'IMAX・英語');assert.doesNotMatch(JSON.stringify(parsed),/seatsAvailable|\$undefined/);
 assert.throws(()=>parseReelaxSchedule(raw,mapping.cinemaId,'2026-11-01'),/Date not confirmed/);
 for(const change of[{theaterId:'t04405'},{theaterName:'另一影城'},{date:'2026-11-01'},{time:'25:10'},{movieName:''}])assert.throws(()=>parseReelaxSchedule(fixture(mapping,'2026-10-31',change),mapping.cinemaId,'2026-10-31'));
 assert.throws(()=>parseReelaxSchedule(raw+raw,mapping.cinemaId,'2026-10-31'),/Unknown schedule/);
 globalThis.__scheduleScriptExecuted=false;const malicious=raw+'<script>globalThis.__scheduleScriptExecuted=true</script>';parseReelaxSchedule(malicious,mapping.cinemaId,'2026-10-31');assert.equal(globalThis.__scheduleScriptExecuted,false);delete globalThis.__scheduleScriptExecuted;
});
test('a failed Vieshow source recovers with correct date/time and preserves third-party provenance in complete Flex times',async()=>{
 const source=new CinemaSource({now,fetcher:async(url,options)=>{if(url.startsWith('https://reelax.app/')){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);return new Response(fixture());}return new Response('',{status:502});}});
 const result=await source.schedule({cinema:'信義威秀',afterTime:'18:00',onlyUpcoming:true});assert.equal(result.status,'ok');assert.equal(result.provider,'reelax');assert.equal(result.afterTime,'18:01');assert.deepEqual(result.movies[0].times,['19:00']);
 const cards=new CinemaCards(),reply=await cards.present('A',[result]);assert.match(reply.text,/Reelax.*第三方/);const complete=await cards.handle('A',reply.messages[1].contents.contents[0].footer.contents[1].action.data);assert.match(complete.text,/來源時刻表：https:\/\/reelax.app/);assert.doesNotMatch(complete.text,/官方時刻表：https:\/\/reelax.app/);assert.match(complete.text,/第三方，非官方更新/);
});
test('source cache coalesces reads, expires, cools down failures and never returns expired schedules',async()=>{
 let current=now(),calls=0,fail=false;const source=new ReelaxSource({now:()=>current,fetcher:async()=>{calls++;return new Response(fail?'':fixture(),{status:fail?503:200});}}),branch=findCinema('信義威秀'),query={date:'2026-10-31',afterTime:'18:00'};
 await Promise.all([source.schedule(branch,query),source.schedule(branch,query)]);assert.equal(calls,1);
 current=new Date(current.valueOf()+301000);fail=true;const result=await source.schedule(branch,query);assert.equal(result.status,'unavailable');assert.equal(result.failure.httpStatus,503);assert.equal(result.movies,undefined);await source.schedule(branch,query);assert.equal(calls,2);
});
test('public source concurrency and queue are bounded, and large responses fail without parsing',async()=>{
 let active=0,maximum=0;const source=new ReelaxSource({fetcher:async url=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,20));active--;return new Response(fixture(mapping,new URL(url).searchParams.get('date')));}});
 const results=await Promise.allSettled(Array.from({length:5},(_,i)=>source.page(mapping.cinemaId,`2026-11-0${i+1}`)));assert.equal(results.filter(row=>row.status==='rejected').length,1);assert.ok(maximum<=2);assert.equal(source.active,0);
 const huge=new ReelaxSource({fetcher:async()=>new Response('x'.repeat(2000001))});assert.equal((await huge.schedule(findCinema('信義威秀'),{date:'2026-10-31'})).failure.kind,'format');
});
test('Chin Chin aliases resolve to the official source and midnight rollovers keep the actual calendar date',async()=>{
 for(const alias of['親親影城','台中親親影城','親親戲院'])assert.equal(findCinema(alias).id,'atmovies-t04405');
 const parsed=parseChinChinOfficial(cc());assert.equal(parsed.rows.at(-1).date,'2026-11-01');assert.equal(parsed.rows.at(-1).time,'00:30');
 const source=new CinemaSource({now,fetcher:async url=>{assert.ok(url.startsWith('https://www.ccmovie.com.tw/'));return new Response(cc());}});const result=await source.schedule({cinema:'親親影城',afterTime:'18:00',onlyUpcoming:true});assert.equal(result.provider,'official');assert.deepEqual(result.movies[0].times,['19:20']);
 assert.throws(()=>parseChinChinOfficial(cc().replace('jump1_2026-10-31','jump1_2026-11-01')),/Invalid official date/);
});
test('government monthly and weekly calendars provide explicit year anchors and reject stale cross-year guessing',()=>{
 const ty='<title>桃園光影文化館</title><body>2026.10月場次表<a href="/Movie_detail/123?bd=2026%2F10%2F31%2000%3A00"><span><b>18:30</b></span><o>虛構測試片</o></a></body>';
 assert.equal(parseTaoyuanOfficial(ty).rows[0].date,'2026-10-31');assert.throws(()=>parseTaoyuanOfficial(ty.replace('2026.10','2026.11')),/Wrong calendar month/);
 const hl='<title>花蓮鐵道電影院 - 測試</title><meta property="article:modified_time" content="2026-10-25T00:00:00Z"><div><div><h2>本週放映</h2></div></div><section><div class="elementor-widget-text-editor"><p>售票場</p><p>10/31（六）19:30《虛構測試片》</p></div></section>';
 assert.equal(parseHualienOfficial(hl).rows[0].date,'2026-10-31');assert.throws(()=>parseHualienOfficial(hl.replace('2026-10-25','2026-07-25')),/Weekly date outside/);
 const nw='<title>內惟藝術中心 | 看電影 | 場次</title><h1>NOW PLAYING</h1><div class="swiper-slide" data-year="2026" data-month="11"><div class="calendar__item not-current-month"><div class="calendar__head"><span>01</span></div><div class="event"><div class="event-title">虛構測試片</div><div class="event-intro"><div><span>18:30</span></div></div><a href="https://www.nwac.org.tw/tw/movies-content/test"></a></div></div><div class="calendar__item"><div class="calendar__head"><span>02</span></div></div></div>';
 const calendar=parseNeiweiOfficial(nw);assert.equal(calendar.rows[0].date,'2026-11-01');assert.equal(calendar.publishedDates.length,2);assert.throws(()=>parseNeiweiOfficial(nw.replace('<span>02</span>','<span>03</span>')),/Invalid calendar sequence/);
});
test('special programme sources and operation notices provide working entry cards without fabricated film schedules or network calls',async()=>{
 const source=new CinemaSource({now,fetcher:async()=>{throw Error('Should not fetch');}}),cards=new CinemaCards();
 for(const cinema of['中壢光影電影館','中山73','嘉年華戲院','金獅影城']){
  const result=await source.schedule({cinema,afterTime:'18:00'});assert.ok(['links_only','operation_notice'].includes(result.status));assert.equal(result.movies,undefined);
  const reply=await cards.present('A',[result]);assert.ok(reply.messages.some(message=>message.type==='flex'));assert.ok(reply.messages[1].contents.contents[0].footer.contents[0].action.uri.startsWith('https://'));assert.doesNotMatch(JSON.stringify(reply),/flex:times:/);
 }
});

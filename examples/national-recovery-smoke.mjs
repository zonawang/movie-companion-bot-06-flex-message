// Individual real user-style queries, not a crawl of third-party publishers. Memory-only; no LINE deliveries.
import assert from 'node:assert/strict';
import {config}from'../src/config.mjs';
import {CinemaSource,taipeiDateTime}from'../src/cinema.mjs';
import {findCinema}from'../src/cinema-registry.mjs';
import {MovieCompanion}from'../src/agent.mjs';
import {MovieSource}from'../src/movies.mjs';
import {CinemaCards}from'../src/cinema-cards.mjs';
import {MovieCardCatalog}from'../src/movie-card-catalog.mjs';
import {Store}from'../src/store.mjs';
import {lineMessages}from'../src/line.mjs';
const settings=config(),store=new Store(),date=taipeiDateTime().date;
async function validate(reply){const response=await fetch('https://api.line.me/v2/bot/message/validate/reply',{method:'POST',headers:{Authorization:'Bearer '+process.env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messages:lineMessages(reply)}),signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,await response.text());}
try{
 for(const [index,prompt,id]of[[0,'信義威秀今晚有哪些電影可以看？','vieshow-xinyi'],[1,'親親影城今晚有哪些電影可以看？','atmovies-t04405'],[2,'高雄環球影城今晚有哪些電影可以看？','atmovies-t07704']]){
  const cinema=new CinemaSource(),cards=new CinemaCards({catalog:new MovieCardCatalog({token:settings.tmdbToken}),fallbackPosterUrl:new URL('/tickets/assets/poster-fallback-v1.jpg',settings.publicBaseUrl).href}),tools=[],actor='national-recovery-fixture-'+index;
  const bot=new MovieCompanion({store,cinema,cards,movies:new MovieSource({mode:settings.mode,token:settings.tmdbToken}),model:settings.model,trace:name=>tools.push(name)}),started=Date.now(),reply=await bot.respond(actor,prompt);
  assert.ok(tools.includes('cinema_schedule'));const snapshot=[...cards.snapshots.values()].find(value=>value.actor===actor);assert.ok(snapshot,'Expected genuine movie cards: '+reply.text);
  const result=snapshot.sources[0];assert.equal(result.cinemaId,id);assert.equal(result.date,date);assert.equal(result.status,'ok');assert.ok(result.afterTime>='18:00');assert.ok(result.movies.every(movie=>movie.times.every(time=>time>=result.afterTime)));
  await validate(reply);const bubbles=reply.messages.find(message=>message.type==='flex').contents.contents;await validate(await cards.handle(actor,bubbles[0].footer.contents[1].action.data));
  const next=bubbles.at(-1).footer.contents.find(item=>item.action?.label==='下一批電影 →');if(next)await validate(await cards.handle(actor,next.action.data));
  assert.equal(store.list(actor).length,0);assert.equal(store.pending(actor),undefined);
  console.log(JSON.stringify({prompt,status:'ok',tools,milliseconds:Date.now()-started,cinema:result.cinema,date:result.date,afterTime:result.afterTime,provider:result.provider,films:snapshot.items.length,showtimes:result.movies.reduce((sum,movie)=>sum+movie.times.length,0),lineValidation:200,nextPageValidated:!!next,ticketWrites:0}));
 }
 const source=new CinemaSource();
 for(const name of['真善美戲院','中影屏東影城']){const branch=findCinema(name),result=await source.thirdParty.schedule(branch,{date});assert.equal(result.status,'ok',JSON.stringify(result));console.log(JSON.stringify({probe:name,provider:result.provider,status:result.status,versions:result.movies.length}));}
 for(const name of['桃園光影文化館','花蓮鐵道電影院','內惟藝術中心']){const result=await source.official.schedule(findCinema(name),{date});assert.ok(['ok','not_published'].includes(result.status),JSON.stringify(result));console.log(JSON.stringify({probe:name,provider:result.provider,status:result.status,versions:result.movies?.length||0}));}
 const entryCards=new CinemaCards();for(const name of['中壢光影電影館','中山73','嘉年華影城','金獅影城']){const result=await source.schedule({cinema:name,date});assert.ok(['links_only','operation_notice'].includes(result.status));await validate(await entryCards.present('entry-fixture',[result]));console.log(JSON.stringify({probe:name,status:result.status,lineValidation:200,filmScheduleParsed:false}));}
 console.log(JSON.stringify({status:'ok',realAdkQueries:3,lineValidation:200,ticketWrites:0}));
}finally{store.close();}

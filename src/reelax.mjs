import { load } from 'cheerio';
import mappings from './reelax-cinemas.json' with { type: 'json' };
import { validDate, validTime } from './atmovies.mjs';
import { normalizeName } from './cinema-registry.mjs';
const branches=new Map(mappings.map(row=>[row.cinemaId,row]));
// Parse public server-rendered JSON as data; never execute scripts or React references.
export function reelaxPageData(html) {
  const $=load(html),candidates=[];
  const stream=$('script:not([src])').map((_,element)=>{
    const match=/^self\.__next_f\.push\(([\s\S]+)\)$/.exec($(element).text().trim());if(!match)return null;
    try{const row=JSON.parse(match[1]);return row[0]===1&&typeof row[1]==='string'?row[1]:null;}catch{return null;}
  }).get().join('');
  function walk(value,depth=0){
    if(!value||typeof value!=='object'||depth>40)return;
    if(value.theater?.id&&Array.isArray(value.initialShowtimes))candidates.push(value);
    for(const child of Object.values(value))walk(child,depth+1);
  }
  for(const line of stream.split('\n')){const colon=line.indexOf(':');if(colon<0)continue;try{walk(JSON.parse(line.slice(colon+1)));}catch{}}
  if(candidates.length!==1)throw new Error('Unknown schedule structure');
  return {$,data:candidates[0]};
}
export function parseReelaxSchedule(html,cinemaId,date) {
  const branch=branches.get(cinemaId);if(!branch||!validDate(date))throw new Error('Unknown cinema/date');
  const {$,data}=reelaxPageData(html);
  if(data.theater.id!==branch.theaterCode||normalizeName(data.theater.name)!==normalizeName(branch.name)
    ||$('h1').length!==1||normalizeName($('h1').text())!==normalizeName(branch.name))throw new Error('Wrong cinema');
  const graph=$('script[type="application/ld+json"]').map((_,element)=>{try{const data=JSON.parse($(element).text());return data['@graph']||[data];}catch{return null;}}).get();
  const identity=graph.filter(value=>value?.['@type']==='MovieTheater'&&value.url===branch.url);
  if(identity.length!==1||normalizeName(identity[0].name)!==normalizeName(branch.name))throw new Error('Missing cinema identity');
  if(data.initialDate!==date||!validDate(data.initialDate))throw Object.assign(new Error('Date not confirmed'),{kind:'date',sourceDate:validDate(data.initialDate||'')?data.initialDate:undefined});
  if(!data.initialShowtimes.length)throw Object.assign(new Error('No confirmed published schedule'),{kind:'empty'});
  const groups=new Map(),updates=[];
  for(const row of data.initialShowtimes){
    if(row.theaterId!==branch.theaterCode||normalizeName(row.theaterName)!==normalizeName(branch.name)||row.date!==date||!validTime(row.time)
      ||typeof row.movieName!=='string'||!row.movieName.trim())throw new Error('Invalid showtime identity/date/time');
    const fields=[row.format,row.language,row.hallType,row.screeningType].filter(value=>typeof value==='string'&&value.trim()&&!value.startsWith('$'));
    const version=[...new Set(fields)].join('・')||'來源未標示版本';
    const title=row.movieName.trim().slice(0,150),detail=new URL('/movie/'+encodeURIComponent(row.movieName),branch.url);
    detail.searchParams.set('theaterId',branch.theaterCode);detail.searchParams.set('date',date);detail.searchParams.set('period','all');
    const key=JSON.stringify([title,version]);if(!groups.has(key))groups.set(key,{title,version,detailUrl:detail.href,times:[]});groups.get(key).times.push(row.time);
    if(typeof row.scrapedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(row.scrapedAt)&&!Number.isNaN(Date.parse(row.scrapedAt)))updates.push(Date.parse(row.scrapedAt));
  }
  return {date,movies:[...groups.values()].map(movie=>({...movie,times:[...new Set(movie.times)].sort()})),...(updates.length?{sourceUpdatedAt:new Date(Math.min(...updates)).toISOString()}: {})};
}
export class ReelaxSource {
  constructor({fetcher=fetch,now=()=>new Date()}={}){this.fetcher=fetcher;this.now=now;this.cache=new Map();this.inflight=new Map();this.failures=new Map();this.active=0;this.waiters=[];}
  supports(id){return branches.has(id);}
  url(id,date){const branch=branches.get(id);return branch?`${branch.url}?date=${date}`:'';}
  async limitedRead(task){
    if(this.active>=2){if(this.waiters.length>=2)throw Object.assign(new Error('Source busy'),{kind:'busy'});await new Promise(resolve=>this.waiters.push(resolve));}else this.active++;
    try{await new Promise(resolve=>setTimeout(resolve,500));return await task();}
    finally{const next=this.waiters.shift();if(next)next();else this.active--;}
  }
  async page(id,date){
    const url=this.url(id,date),now=this.now().valueOf();
    for(const[key,value]of this.cache)if(now-value.fetched>=300000)this.cache.delete(key);
    for(const[key,value]of this.failures)if(value.until<=now)this.failures.delete(key);
    if(this.cache.has(url))return this.cache.get(url);if(this.inflight.has(url))return this.inflight.get(url);if(this.failures.has(url))throw this.failures.get(url).error;
    const pending=this.limitedRead(async()=>{
      const response=await this.fetcher(url,{signal:AbortSignal.timeout(5000),redirect:'error',credentials:'omit',headers:{'User-Agent':'MovieCompanionLearningBot/0.4',accept:'text/html'}});
      if(!response.ok)throw Object.assign(new Error('Schedule HTTP'),{kind:'http',httpStatus:response.status});
      const reader=response.body.getReader(),chunks=[];let length=0;
      try{while(true){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000000){await reader.cancel();throw Object.assign(new Error('Page too large'),{kind:'format'});}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
      let parsed;try{parsed=parseReelaxSchedule(Buffer.concat(chunks).toString('utf8'),id,date);}catch(error){throw error.kind?error:Object.assign(new Error('Unknown schedule format'),{kind:'format'});}
      const page={...parsed,fetched:this.now().valueOf()};if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value);this.cache.set(url,page);return page;
    });
    this.inflight.set(url,pending);try{return await pending;}catch(error){if(this.failures.size>=100)this.failures.delete(this.failures.keys().next().value);this.failures.set(url,{until:this.now().valueOf()+30000,error});throw error;}finally{this.inflight.delete(url);}
  }
  async schedule(cinema,{date,afterTime='',onlyUpcoming=false}){
    if(!this.supports(cinema.id))return null;
    const base={cinemaId:cinema.id,cinema:cinema.name,brand:cinema.brand,provider:'reelax',source:'有影啦 Reelax（第三方時刻表，非影城官方）',sourceUrl:this.url(cinema.id,date),bookingUrl:cinema.bookingUrl,websiteFromDirectory:cinema.websiteFromDirectory||false,date,afterTime,onlyUpcoming};
    try{const page=await this.page(cinema.id,date),movies=page.movies.map(movie=>({...movie,times:movie.times.filter(time=>time>=afterTime)})).filter(movie=>movie.times.length).sort((a,b)=>a.times[0].localeCompare(b.times[0]));return{...base,status:movies.length?'ok':'no_upcoming',sourceDate:page.date,fetchedAt:new Date(page.fetched).toISOString(),sourceUpdatedAt:page.sourceUpdatedAt,movies};}
    catch(error){return{...base,status:'unavailable',failure:{kind:error.kind||'network',...(error.httpStatus?{httpStatus:error.httpStatus}:{})},...(error.sourceDate?{sourceDate:error.sourceDate}:{}),message:'備援尚無可核對的場次，請開啟來源或影城官網確認；不代表沒有放映。'};}
  }
}

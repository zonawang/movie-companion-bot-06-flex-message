import { load } from 'cheerio';
import { normalizeName } from './cinema-registry.mjs';

const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const timeValid = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const configs = {
  'atmovies-t03312': { type: 'links', name: '中壢光影電影館', url: 'https://www.taoyuan.arts-cinema.com/', source: '中壢光影電影館官方節目入口', message: '此館的公開節目資料尚未完成自動解析，請從官方入口核對指定日期與時間；不代表沒有放映。' },
  'atmovies-t04427': { type: 'links', name: '中山73影視藝文空間', url: 'https://www.tfdf.org.tw/page.php', source: '臺中市影視發展基金會官方節目入口', message: '此館以節目表圖片／刊物公告場次，目前提供官方入口核對，尚未自動擷取每場片名與時間。' },
  'atmovies-t05502': { type: 'links', name: '嘉年華影城', url: 'https://www.3d-movies.tw/time.aspx', source: '嘉年華影城官方場次入口', message: '官方有日期選單，但目前未能讀取選定日期的電影清單，請開啟官方場次頁核對；不代表沒有放映。' },
  'atmovies-t03311': { type: 'taoyuan', name: '桃園光影文化館', url: 'https://tyac2.afmc.gov.tw/Event_table', source: '桃園光影文化館官方場次表' },
  'atmovies-t03804': { type: 'hualien', name: '花蓮鐵道電影院', url: 'https://film.hccc.gov.tw/?page_id=4916', source: '花蓮鐵道電影院官方本週放映' },
  'atmovies-t07731': { type: 'neiwei', name: '內惟藝術中心', url: 'https://www.nwac.org.tw/tw/movie-showings', source: '內惟藝術中心官方場次表' },
  'atmovies-t04405': { type: 'chinchin', name: '親親影城', url: 'https://www.ccmovie.com.tw/product.php?_path=product_showtimes', source: '親親影城官方公開場次頁' },
  'atmovies-t02a13': { type: 'showtime', name: '大巨蛋秀泰影城', url: 'https://www.showtimes.com.tw/cinemas/91/', source: '秀泰影城官方公開場次頁' },
  'atmovies-t04411': { type: 'showtime', name: '台中文心秀泰影城', url: 'https://www.showtimes.com.tw/cinemas/56/', source: '秀泰影城官方公開場次頁' },
  'atmovies-t02d02': { type: 'ambassador', name: '台北長春國賓影城', id: '453b2966-f7c2-44a9-b2eb-687493855d0e', url: 'https://www.ambassador.com.tw/home/Showtime?ID=453b2966-f7c2-44a9-b2eb-687493855d0e', source: '國賓影城官方公開時刻表' },
  'atmovies-t06902': { type: 'in89', name: '澎湖昇恆昌in89豪華影城', id: '1', url: 'https://www.in89cinemax.com/film_list.aspx?TheaterId=14', api: 'https://penghu.in89.com.tw/api/api_movie.php?method=getStagesByDate', source: 'in89 官方公開場次資料' },
};
export const officialCinemaUrl = id => configs[id]?.url || '';
function add(rows, date, title, version, time, detailUrl) {
  if (!dateValid(date) || !timeValid(time) || typeof title !== 'string' || !title.trim()) throw new Error('Invalid official schedule');
  rows.push({ date, title: title.trim().slice(0,150), version: version.trim().slice(0,80) || '來源未標示版本', time, detailUrl });
}
function safeLink(value, base, path) {
  try { const url = new URL(value, base); return url.origin === new URL(base).origin && path.test(url.pathname) ? url.href : null; } catch { return null; }
}
export function parseShowtimeOfficial(html, cinemaId = 'atmovies-t04411') {
  const config = configs[cinemaId]; if (!config || config.type !== 'showtime') throw new Error('Unknown cinema');
  const $ = load(html);
  if (!$('h1').toArray().some(el => normalizeName($(el).text().trim()) === normalizeName(config.name))) throw new Error('Wrong cinema');
  const anchors = $('script[type="application/ld+json"]').map((_,el) => {
    try { const body = JSON.parse($(el).text()); return body['@type'] === 'ScreeningEvent' && typeof body.startDate === 'string' ? body.startDate.slice(0,10) : null; } catch { return null; }
  }).get().filter(dateValid).sort();
  if (!anchors.length) throw new Error('Missing year anchor');
  const anchor = anchors[0], year = Number(anchor.slice(0,4)), rows = [], dates = new Set();
  // JSON-LD is capped by the official page; read ALL displayed date groups instead of only those first events.
  $('.seo-card h3').each((_,el) => {
    const title = $(el).text().trim(), detailUrl = safeLink($(el).find('a').attr('href'),config.url,/^\/programs\/\d+\/$/);
    let date = '';
    $(el).nextUntil('h3').each((_,node) => {
      const item = $(node), match = /^(\d{1,2})月(\d{1,2})日\s/.exec(item.is('p') ? item.text().trim() : '');
      if (match) {
        const candidates = [year-1,year,year+1].map(y=>`${y}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`).filter(dateValid)
          .sort((a,b)=>Math.abs(Date.parse(a)-Date.parse(anchor))-Math.abs(Date.parse(b)-Date.parse(anchor)));
        date = candidates[0]; if (!date || Math.abs(Date.parse(date)-Date.parse(anchor))>183*86400000) throw new Error('Ambiguous official date');
        dates.add(date);
      }
      if (item.hasClass('seo-showtime-grid')) item.find('a').each((_,a) => {
        if (!safeLink($(a).attr('href'),config.url,/^\/ticketing\/cart\/selectTicketTypes\/\d+$/)) throw new Error('Invalid showtime link');
        add(rows,date,title,$(a).find('.f').text(),$(a).find('.t').text().normalize('NFKC').trim(),detailUrl);
      });
    });
  });
  if (!rows.length) throw new Error('No readable official showtimes');
  return { rows, publishedDates:[...dates].sort() };
}
export function parseAmbassadorOfficial(html) {
  const config = configs['atmovies-t02d02'], $ = load(html);
  if (!$('h1').toArray().some(el => normalizeName($(el).text().trim()) === normalizeName(config.name))) throw new Error('Wrong cinema');
  const decodeDate = value => {
    try { const u = new URL(value,config.url); const d = (u.searchParams.get('DT') || '').replaceAll('/','-');
      return u.origin === 'https://www.ambassador.com.tw' && u.pathname.toLowerCase() === '/home/showtime' && u.searchParams.get('ID') === config.id && dateValid(d) ? d : null;
    } catch { return null; }
  };
  const selected = $('.search-bar-page .has-submenu > a').map((_,el)=>decodeDate($(el).attr('href'))).get();
  if (new Set(selected).size !== 1) throw new Error('Ambiguous official date');
  const date = selected[0], dates = new Set($('a[href]').map((_,el)=>decodeDate($(el).attr('href'))).get()), rows=[];
  $('.showtime-item .theater-box').each((_,el)=>{
    const item=$(el), link=item.find('h3>a').first(), title=link.clone().children().remove().end().text().trim();
    const detailUrl=safeLink(link.attr('href'),config.url,/^\/home\/MovieContent$/i);
    const label=item.children('.tag-seat').text().trim(), version=/^[（(]([^）)]+)[）)]/.exec(label)?.[1] || '來源未標示版本';
    const times=item.find('.seat-list > li > h6'); if (!times.length) throw new Error('Missing official showtimes');
    times.each((_,time)=>add(rows,date,title,version,$(time).text().normalize('NFKC').trim(),detailUrl));
  });
  if (!rows.length) throw new Error('No readable official showtimes');
  return { rows,publishedDates:[...dates].sort() };
}
export function parseIn89Official(body) {
  const config=configs['atmovies-t06902'];
  if (!body || String(body.theater_id)!==config.id || normalizeName(body.name || '')!==normalizeName(config.name)) throw new Error('Wrong cinema');
  if (!body.movies || typeof body.movies!=='object' || !body.stages || typeof body.stages!=='object') throw new Error('Invalid official data');
  const rows=[], dates=new Set();
  const visit=(value,depth=0)=>{
    if (depth>6) throw new Error('Invalid stage depth');
    if (!value || typeof value!=='object') throw new Error('Invalid stage data');
    if (Object.hasOwn(value,'movie_show_time')) {
      const movie=body.movies[String(value.movie_id)], match=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):[0-5]\d$/.exec(value.movie_show_time);
      if (!movie || !match || String(movie.movie_id)!==String(value.movie_id)) throw new Error('Invalid stage movie/date');
      const [ ,date,time]=match;
      const version=[movie.movie_play_desc,movie.movie_lang_desc,value.theater_film_name].filter(v=>typeof v==='string'&&v.trim()).join('・');
      const detail=new URL('https://www.in89cinemax.com/film_detail.aspx');
      detail.searchParams.set('TheaterId','14'); detail.searchParams.set('movie_id',String(movie.movie_id));
      add(rows,date,movie.movie_group_name,version,time,detail.href); dates.add(date); return;
    }
    for (const child of Object.values(value)) visit(child,depth+1);
  };
  visit(body.stages);
  if (!rows.length) throw new Error('No readable official showtimes');
  return { rows,publishedDates:[...dates].sort() };
}

export function parseChinChinOfficial(html) {
  const config=configs['atmovies-t04405'],$=load(html),rows=[],dates=new Set();
  if(!/親親影城官網/.test($('title').text())||!$('footer').text().includes('親親影城'))throw new Error('Wrong cinema');
  $('.showtime-item .theater-box').each((_,element)=>{
    const item=$(element),title=item.find('.m_title').first().clone().children().remove().end().text().trim();
    const detailUrl=safeLink(item.find('a[href*="product_detail"]').first().attr('href'),config.url,/^\/product\.php$/);
    item.find('.tab-pane').each((_,element)=>{
      const pane=$(element),date=pane.find('.dateDisplay').text().trim(),match=/^jump\d+_(\d{4}-\d{2}-\d{2})$/.exec(pane.attr('id')||'');
      if(!match||match[1]!==date||!dateValid(date))throw new Error('Invalid official date');
      dates.add(date);const version=pane.find('.dateMovie').text().trim(),times=pane.find('.seat-list .sky_word .float-left.info');
      if(!version||!times.length)throw new Error('Missing official version/times');
      let previous='',rollover=false;
      times.each((_,element)=>{
        const time=$(element).text().normalize('NFKC').trim();
        if(previous&&time<previous){if(rollover||time>='06:00'||previous<'18:00')throw new Error('Ambiguous midnight');rollover=true;}
        if(rollover&&time>='06:00')throw new Error('Ambiguous midnight');
        const actualDate=rollover?new Date(Date.parse(date)+86400000).toISOString().slice(0,10):date;
        add(rows,actualDate,title,version,time,detailUrl);dates.add(actualDate);previous=time;
      });
    });
  });
  if(!rows.length)throw new Error('No official showtimes');return{rows,publishedDates:[...dates].sort()};
}


export function parseTaoyuanOfficial(html) {
  const config=configs['atmovies-t03311'],$=load(html),rows=[];
  if(!$('title').text().includes(config.name))throw new Error('Wrong cinema');
  const month=/\b(20\d{2})\.(\d{1,2})月場次表/.exec($('body').text());if(!month)throw new Error('Missing month/year');
  const prefix=month[1]+'-'+month[2].padStart(2,'0'),dates=new Set();
  for(let day=1;day<=31;day++){const date=prefix+'-'+String(day).padStart(2,'0');if(dateValid(date))dates.add(date);}
  $('a[href^="/Movie_detail/"]').each((_,element)=>{
    const item=$(element),url=new URL(item.attr('href'),config.url),raw=url.searchParams.get('bd')||'',match=/^(\d{4})\/(\d{2})\/(\d{2}) 00:00$/.exec(raw);
    if(!match)throw new Error('Invalid calendar date');const date=match.slice(1).join('-');if(!date.startsWith(prefix)||!dates.has(date))throw new Error('Wrong calendar month');
    add(rows,date,item.children('o').text(), '來源未標示版本', item.find('b').first().text().trim(),url.href);
  });
  return{rows,publishedDates:[...dates].sort()};
}
export function parseHualienOfficial(html) {
  const config=configs['atmovies-t03804'],$=load(html),rows=[],dates=new Set();
  if(!$('title').text().startsWith(config.name))throw new Error('Wrong cinema');
  const anchor=$('meta[property="article:modified_time"]').attr('content')?.slice(0,10);if(!dateValid(anchor||''))throw new Error('Missing weekly year anchor');
  const heading=$('h2').filter((_,element)=>$(element).text().trim()==='本週放映');if(heading.length!==1)throw new Error('Missing weekly schedule');
  const content=heading.parent().parent().next('section').find('.elementor-widget-text-editor');if(content.length!==1)throw new Error('Ambiguous weekly schedule');
  let version='官方本週放映';
  content.find('p').each((_,element)=>{
    const item=$(element).clone();item.find('br').replaceWith('\n');
    for(const line of item.text().split('\n').map(value=>value.trim()).filter(Boolean)){
      if(line.includes('售票場')){version='售票場';continue;}if(line.includes('免費推廣場')){version='免費推廣場';continue;}
      const match=/^(\d{1,2})\/(\d{1,2})[（(][^）)]+[）)]\s*(\d{2}:\d{2})\s*(.+)$/.exec(line);if(!match)continue;
      const year=Number(anchor.slice(0,4)),candidates=[year-1,year,year+1].map(y=>`${y}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`).filter(dateValid).sort((a,b)=>Math.abs(Date.parse(a)-Date.parse(anchor))-Math.abs(Date.parse(b)-Date.parse(anchor)));
      const date=candidates[0];if(!date||Math.abs(Date.parse(date)-Date.parse(anchor))>14*86400000)throw new Error('Weekly date outside publication window');
      add(rows,date,match[4],version,match[3],config.url);dates.add(date);
    }
  });
  if(!rows.length)throw new Error('No readable weekly showtimes');return{rows,publishedDates:[...dates].sort()};
}
export function parseNeiweiOfficial(html) {
  const config=configs['atmovies-t07731'],$=load(html),rows=[],dates=new Set();
  if(!$('title').text().trim().startsWith(config.name+' |')||!$('body').text().includes('NOW PLAYING'))throw new Error('Wrong cinema');
  $('.swiper-slide[data-year][data-month]').each((_,element)=>{
    const slide=$(element),year=slide.attr('data-year'),month=slide.attr('data-month');
    const items=slide.find('.calendar__item'),first=items.toArray().findIndex(element=>$(element).find('.calendar__head>span').first().text().trim()==='01');
    if(first<0||first>6)throw new Error('Missing first calendar day');
    items.each((index,element)=>{
      const item=$(element),date=new Date(Date.UTC(Number(year),Number(month)-1,1+index-first)).toISOString().slice(0,10);
      const day=item.find('.calendar__head>span').first().text().trim();if(Number(day)!==Number(date.slice(-2)))throw new Error('Invalid calendar sequence');
      if(date.slice(0,7)!==`${year}-${month.padStart(2,'0')}`)return;dates.add(date);
      item.find('.event').each((_,element)=>{
        const event=$(element),title=event.find('.event-title').first().text().trim(),time=event.find('.event-intro>div>span').first().text().trim();
        const detailUrl=safeLink(event.find('a').first().attr('href'),config.url,/^\/tw\/movie/);
        add(rows,date,title,'官方場次',time,detailUrl);
      });
    });
  });
  if(!dates.size)throw new Error('Missing calendar');return{rows,publishedDates:[...dates].sort()};
}

export class OfficialCinemaSource {
  constructor({fetcher=fetch,now=()=>new Date()}={}) {this.fetcher=fetcher;this.now=now;this.cache=new Map();this.inflight=new Map();this.retryAt=new Map();this.errors=new Map();}
  supports(id) {return !!configs[id];}
  prefers(id) {return ['links','chinchin','taoyuan','hualien','neiwei'].includes(configs[id]?.type);}
  async page(id,date) {
    const config=configs[id], url=new URL(config.api || config.url);
    if(config.type==='ambassador')url.searchParams.set('DT',date.replaceAll('-','/'));
    const key=url.href, now=this.now().valueOf();
    for(const [k,v] of this.cache)if(now-v.fetched>=300000)this.cache.delete(k);
    for(const [k,v] of this.retryAt)if(v<=now){this.retryAt.delete(k);this.errors.delete(k);}
    if(this.cache.has(key))return this.cache.get(key);
    if(this.inflight.has(key))return this.inflight.get(key);
    if(this.retryAt.has(key))throw this.errors.get(key) || Object.assign(new Error('Official source cooling down'),{kind:'network'});
    this.retryAt.set(key,now+30000);
    const pending=(async()=>{
      const options={headers:{'User-Agent':'MovieCompanionLearningBot/0.3',accept:config.type==='in89'?'application/json':'text/html'},signal:AbortSignal.timeout(6000),redirect:'error',credentials:'omit'};
      if(config.type==='in89'){options.method='POST';options.headers['Content-Type']='application/x-www-form-urlencoded';options.body=new URLSearchParams({method:'getStagesByDate'});}
      const response=await this.fetcher(key,options);if(!response.ok)throw Object.assign(new Error('Official HTTP'),{kind:'http',httpStatus:response.status});
      // Bound response size before parsing; no login/session, booking, seats or payment API calls.
      const reader=response.body.getReader(), chunks=[];let bytes=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2000000){await reader.cancel();throw new Error('Official response too large');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
      const raw=Buffer.concat(chunks).toString('utf8');
      let parsed;
      try{parsed=config.type==='taoyuan'?parseTaoyuanOfficial(raw):config.type==='hualien'?parseHualienOfficial(raw):config.type==='neiwei'?parseNeiweiOfficial(raw):config.type==='chinchin'?parseChinChinOfficial(raw):config.type==='showtime'?parseShowtimeOfficial(raw,id):config.type==='ambassador'?parseAmbassadorOfficial(raw):parseIn89Official(JSON.parse(raw));}
      catch{throw Object.assign(new Error('Unrecognized official data'),{kind:'format'});}
      const page={...parsed,fetched:this.now().valueOf(),sourceUrl:config.type==='ambassador'?key:config.url};
      if(this.cache.size>=50)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,page);return page;
    })();
    this.inflight.set(key,pending);try{return await pending;}catch(error){this.errors.set(key,error);throw error;}finally{this.inflight.delete(key);}
  }
  async schedule(cinema,{date,afterTime='',onlyUpcoming=false}) {
    const config=configs[cinema.id];if(!config)return null;
    const base={cinemaId:cinema.id,cinema:cinema.name,brand:cinema.brand,provider:'official',source:config.source,sourceUrl:config.url,bookingUrl:config.url,date,afterTime,onlyUpcoming};
    if(config.type==='links')return {...base,status:'links_only',sourcePolicy:'official_entry',message:config.message};
    try{
      const page=await this.page(cinema.id,date), meta={...base,sourceUrl:page.sourceUrl,fetchedAt:new Date(page.fetched).toISOString(),publishedDates:page.publishedDates};
      if(!page.publishedDates.includes(date))return {...meta,status:'not_published'};
      if(!page.rows.some(row=>row.date===date))return {...meta,status:'not_published'};
      const groups=new Map();
      for(const row of page.rows)if(row.date===date&&row.time>=afterTime){
        const key=JSON.stringify([row.title,row.version,row.detailUrl]);
        if(!groups.has(key))groups.set(key,{title:row.title,version:row.version,detailUrl:row.detailUrl,times:[]});groups.get(key).times.push(row.time);
      }
      const movies=[...groups.values()].map(movie=>({...movie,times:[...new Set(movie.times)].sort()})).sort((a,b)=>a.times[0].localeCompare(b.times[0]));
      return {...meta,status:movies.length?'ok':'no_upcoming',movies};
    }catch(error){const kind=error.kind||'network';const reason=kind==='http'?`官方來源連線失敗（HTTP ${error.httpStatus}）`:kind==='format'?'官方來源格式無法辨識或分館／日期無法核對':'官方來源連線失敗或逾時';return {...base,status:'unavailable',failure:{kind,...(error.httpStatus?{httpStatus:error.httpStatus}:{})},message:reason+'，請開啟影城官網確認。'};}
  }
}

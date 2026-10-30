import { randomBytes } from 'node:crypto';
import { formatCinemaSchedule, taipeiDateTime } from './cinema.mjs';
import { tmdbAttribution } from './attribution.mjs';
const PAGE_SIZE = 5, TTL = 10 * 60_000;
const text = (value, options = {}) => ({ type: 'text', text: String(value || '未提供'), wrap: true, size: 'sm', color: '#243D34', ...options });
const box = (contents, options = {}) => ({ type: 'box', layout: 'vertical', contents, ...options });
const button = (label, data, primary = false) => ({ type: 'button', height: 'sm', style: primary ? 'primary' : 'secondary', ...(primary ? { color: '#243D34' } : {}), action: { type: 'postback', label, data } });
const safeSource = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['meet.eslite.com', 'arthouse.eslite.com', 'www.atmovies.com.tw'].includes(url.hostname) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
};
const action = (verb, token, index) => `flex:${verb}:${token}:${index}`;
export class CinemaCards {
  constructor({ catalog, now = () => Date.now(), ttl = TTL } = {}) { this.catalog = catalog; this.now = now; this.ttl = ttl; this.snapshots = new Map(); }
  prune() { for (const [token, snapshot] of this.snapshots) if (snapshot.until <= this.now()) this.snapshots.delete(token); }
  async present(actor, results) {
    this.prune();
    const items = [], failures = [], sources = [];
    for (const result of results.slice(0, 3)) {
      if (result.status !== 'ok' || !Array.isArray(result.movies) || !result.movies.length) { failures.push(formatCinemaSchedule(result)); continue; }
      sources.push(result);
      const groups = new Map();
      for (const movie of result.movies) {
        if (!movie.title || !Array.isArray(movie.times)) continue;
        const times = [...new Set(movie.times.filter(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)))].sort();
        if (!times.length) continue;
        const title = movie.title.slice(0, 150), detailUrl = safeSource(movie.detailUrl), id = JSON.stringify([title, detailUrl]);
        if (!groups.has(id)) groups.set(id, { title, detailUrl, cinema: result.cinema, cinemaId: result.cinemaId, date: result.date, sourceUrl: safeSource(result.sourceUrl), provider: result.provider, versions: [] });
        const item = groups.get(id), version = typeof movie.version === 'string' ? movie.version.slice(0, 80) : '';
        const existing = item.versions.find(entry => entry.label === version);
        if (existing) existing.times = [...new Set([...existing.times, ...times])].sort();
        else item.versions.push({ label: version, times });
      }
      items.push(...groups.values());
    }
    if (!items.length) return null;
    while (this.snapshots.size >= 100) this.snapshots.delete(this.snapshots.keys().next().value);
    const token = randomBytes(12).toString('hex');
    const snapshot = { actor, until: this.now() + this.ttl, items: items.slice(0, 150), total: items.length, sources, failures, metadata: new Map() };
    this.snapshots.set(token, snapshot);
    return this.page(token, snapshot, 0);
  }
  async enrich(snapshot, entries) {
    await Promise.all(entries.map(async item => {
      if (snapshot.metadata.has(item.title)) return;
      try { snapshot.metadata.set(item.title, await this.catalog?.lookup(item.title) || null); }
      catch { snapshot.metadata.set(item.title, null); }
    }));
  }
  heading(snapshot, page) {
    const count = snapshot.items.length, lines = [];
    for (const result of snapshot.sources) {
      lines.push(`${result.cinema}｜${result.date}${result.afterTime ? `｜${result.afterTime} 起` : ''}`);
      if (result.fetchedAt) { const local = taipeiDateTime(new Date(result.fetchedAt)); lines.push(`讀取：${local.date} ${local.time}（台灣時間）`); }
      if (result.updatedAt) lines.push(`來源更新：${result.updatedAt}`);
      lines.push(`來源：${result.source || '影城場次資料'}`);
      if (safeSource(result.sourceUrl)) lines.push(safeSource(result.sourceUrl));
    }
    lines.push(`第 ${page + 1}/${Math.ceil(count / PAGE_SIZE)} 頁・${count} 部電影／影城組合，左右滑動查看。`);
    lines.push('依來源場次列出；點「電影介紹」了解內容。');
    if (snapshot.total > count) lines.push('候選較多，先提供前 150 筆，其餘請指定分館或見來源。');
    lines.push(snapshot.sources.some(source => source.provider === 'atmovies') ? '含開眼第三方資料，可能延遲；場次、版本與售票以影城為準。' : '場次與售票異動以影城為準。');
    lines.push('卡片按鈕 10 分鐘內有效；此頁保留查詢時的資料，不代表即時座位或票價。');
    if (snapshot.items.some(item => item.versions.some(version => version.times.some(time => time < '06:00')))) lines.push('凌晨場依來源日期列出，實際入場日期請向影城確認。');
    if (snapshot.failures.length) lines.push(...snapshot.failures);
    return lines.join('\n').slice(0, 3800);
  }
  card(item, index, token, metadata) {
    const hero = metadata?.posterUrl ? { type: 'image', url: metadata.posterUrl, size: 'full', aspectRatio: '3:4', aspectMode: 'cover' }
      : box([text('ZONA MOVIE', { size: 'xs', color: '#E6EADC', align: 'center' }), text('每一場電影\n都是一段故事', { size: 'xl', weight: 'bold', color: '#FFFEF5', align: 'center', margin: 'lg' })], { height: '347px', justifyContent: 'center', paddingAll: '24px', backgroundColor: '#243D34' });
    const versions = item.versions.slice(0, 2).map(version => text(`${version.label || '來源未另標版本'}\n${version.times.slice(0, 3).join('　')}${version.times.length > 3 ? ' …' : ''}`, { margin: 'md', size: 'sm' }));
    const overview = metadata?.overview ? metadata.overview.slice(0, 72) + (metadata.overview.length > 72 ? '…' : '') : '暫無簡介，可點「電影介紹」查看來源。';
    return { type: 'bubble', size: 'kilo', hero,
      body: box([text(`${item.cinema}｜${item.date}`, { size: 'xs', color: '#6B786B' }), text(item.title, { size: 'lg', weight: 'bold', margin: 'md' }),
        text(overview, { size: 'sm', color: '#59675C', margin: 'md', maxLines: 3 }), { type: 'separator', margin: 'lg', color: '#D7DCCF' }, ...versions,
        ...(item.versions.length > 2 ? [text('另有其他版本，請看完整場次', { size: 'xs', margin: 'sm' })] : [])], { backgroundColor: '#F6F4ED', paddingAll: '18px' }),
      footer: box([button('電影介紹', action('info', token, index)), button('完整場次', action('times', token, index), true)], { spacing: 'sm', paddingAll: '14px', backgroundColor: '#F6F4ED' }) };
  }
  async page(token, snapshot, page) {
    if (!Number.isSafeInteger(page) || page < 0 || page >= Math.ceil(snapshot.items.length / PAGE_SIZE)) return this.expired();
    const offset = page * PAGE_SIZE, entries = snapshot.items.slice(offset, offset + PAGE_SIZE);
    await this.enrich(snapshot, entries);
    const flex = { type: 'flex', altText: `${snapshot.sources.map(source => source.cinema).join('、')}電影卡片，第 ${page + 1} 頁`.slice(0, 350), contents: { type: 'carousel', contents: entries.map((item, index) => this.card(item, offset + index, token, snapshot.metadata.get(item.title))) } };
    const navigation = [];
    if (page > 0) navigation.push({ type: 'action', action: { type: 'postback', label: '上一頁', data: action('page', token, page - 1), displayText: '查看上一頁電影' } });
    if (offset + PAGE_SIZE < snapshot.items.length) navigation.push({ type: 'action', action: { type: 'postback', label: '看更多電影', data: action('page', token, page + 1), displayText: '查看更多電影' } });
    if (navigation.length) flex.quickReply = { items: navigation };
    const header = this.heading(snapshot, page) + (entries.some(item => snapshot.metadata.get(item.title)) ? '\n\n' + tmdbAttribution() : '');
    return { text: header, messages: [{ type: 'text', text: header }, flex] };
  }
  expired() { return { text: '這組電影卡片已過期或不屬於目前的對話，請重新輸入影城名稱查詢。' }; }
  async handle(actor, data) {
    this.prune();
    const match = /^flex:(page|info|times):([a-f0-9]{24}):(\d{1,3})$/.exec(data);
    if (!match) return this.expired();
    const [, verb, token, rawIndex] = match, snapshot = this.snapshots.get(token), index = Number(rawIndex);
    if (!snapshot || snapshot.actor !== actor) return this.expired();
    if (verb === 'page') return this.page(token, snapshot, index);
    const item = snapshot.items[index]; if (!item) return this.expired();
    if (verb === 'times') {
      const source = snapshot.sources.find(result => result.cinemaId === item.cinemaId && result.date === item.date);
      const detail = { ...source, movies: item.versions.map(version => ({ title: item.title, version: version.label, times: version.times })) };
      return { text: formatCinemaSchedule(detail), quickReplies: [{ type: 'postback', label: '回電影卡片', data: action('page', token, Math.floor(index / PAGE_SIZE)) }] };
    }
    await this.enrich(snapshot, [item]);
    const metadata = snapshot.metadata.get(item.title);
    const description = metadata?.overview || '目前沒有這部電影的簡介，請開啟來源介紹了解內容。';
    const lines = [`${item.title}\n${item.cinema}｜${item.date}`, description];
    if (metadata) lines.push(metadata.url, tmdbAttribution());
    if (item.detailUrl) lines.push(`來源電影介紹：${item.detailUrl}`);
    else if (item.sourceUrl) lines.push(`影城片單來源：${item.sourceUrl}`);
    return { text: lines.join('\n\n'), quickReplies: [{ type: 'postback', label: '完整場次', data: action('times', token, index) }, { type: 'postback', label: '回電影卡片', data: action('page', token, Math.floor(index / PAGE_SIZE)) }] };
  }
}

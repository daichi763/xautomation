// 情報ソース監視リスト(指示書§04準拠)
// YouTube Data API / X監視はAPIキーが必要なため後日追加(キー取得後に有効化)

export interface RedditSource {
  subreddit: string
  min_upvotes: number
  category: string
}

export interface RssSource {
  url: string
  name: string
}

export const SOURCES = {
  reddit: [
    // 海外AI副業系
    { subreddit: 'Entrepreneur', min_upvotes: 500, category: '海外AI副業' },
    { subreddit: 'SideHustle', min_upvotes: 300, category: '海外AI副業' },
    { subreddit: 'juststart', min_upvotes: 100, category: '海外AI副業' },
    { subreddit: 'passive_income', min_upvotes: 200, category: '海外AI副業' },
    { subreddit: 'KDP', min_upvotes: 100, category: '海外AI副業' },
    { subreddit: 'Etsy', min_upvotes: 200, category: '海外AI副業' },
    { subreddit: 'PrintOnDemand', min_upvotes: 100, category: '海外AI副業' },
    { subreddit: 'AI_Agents', min_upvotes: 100, category: 'AIツール' },
    { subreddit: 'ChatGPT', min_upvotes: 500, category: 'AIツール' },
    { subreddit: 'ClaudeAI', min_upvotes: 200, category: 'AIツール' },
    // Faceless動画系
    { subreddit: 'NewTubers', min_upvotes: 200, category: 'Faceless動画' },
    { subreddit: 'PartneredYoutube', min_upvotes: 100, category: 'Faceless動画' },
  ] as RedditSource[],

  rss: [
    { url: 'https://www.indiehackers.com/feed.xml', name: 'Indie Hackers' },
    { url: 'https://www.producthunt.com/feed', name: 'Product Hunt Daily' },
    { url: 'https://www.starterstory.com/blog.rss', name: 'Starter Story' },
    { url: 'https://hnrss.org/newest?q=side+hustle+OR+passive+income+OR+AI+business&points=50', name: 'Hacker News (副業関連)' },
  ] as RssSource[],

  // YouTube Data API キー取得後に有効化(指示書§04)
  youtube: { channel_ids: [] as string[], max_age_hours: 48 },
}

export interface RawItem {
  title: string
  url: string
  source: string
  score?: number
  summary?: string
  published?: string
}

// ---- RSS/Atom 軽量パーサ(Workers環境: DOMParserなし → 正規表現ベース) ----
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? decodeEntities(m[1]) : ''
}

export function parseFeed(xml: string, sourceName: string, maxItems = 10): RawItem[] {
  const items: RawItem[] = []
  // RSS 2.0 <item> / Atom <entry>
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
  for (const block of blocks.slice(0, maxItems)) {
    const title = extractTag(block, 'title')
    let url = extractTag(block, 'link')
    if (!url) {
      // Atom: <link href="..."/>
      const m = block.match(/<link[^>]*href="([^"]+)"/i)
      if (m) url = m[1]
    }
    const summary = (extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content')).slice(0, 300)
    const published = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated')
    if (title && url) items.push({ title, url, source: sourceName, summary, published })
  }
  return items
}

// ---- 収集 ----
const FETCH_TIMEOUT_MS = 10000

async function fetchWithTimeout(url: string, headers: Record<string, string> = {}): Promise<Response | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok ? res : null
  } catch {
    return null
  }
}

export async function collectRss(maxPerFeed = 8): Promise<{ items: RawItem[]; errors: string[] }> {
  const items: RawItem[] = []
  const errors: string[] = []
  const results = await Promise.allSettled(
    SOURCES.rss.map(async (feed) => {
      const res = await fetchWithTimeout(feed.url, { 'User-Agent': 'Mozilla/5.0 (compatible; RikoBot/1.0)' })
      if (!res) throw new Error(`fetch failed: ${feed.name}`)
      const xml = await res.text()
      return parseFeed(xml, feed.name, maxPerFeed)
    })
  )
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value)
    else errors.push(`RSS ${SOURCES.rss[i].name}: ${r.reason?.message || 'error'}`)
  })
  return { items, errors }
}

export async function collectReddit(maxPerSub = 5): Promise<{ items: RawItem[]; errors: string[] }> {
  const items: RawItem[] = []
  const errors: string[] = []
  // 全subredditは重いので上位カテゴリからランダムに6つ選択(日替わりローテーション)
  const dayIndex = Math.floor(Date.now() / 86400000)
  const subs = [...SOURCES.reddit]
  const picked: RedditSource[] = []
  for (let i = 0; i < 6 && subs.length > 0; i++) {
    picked.push(subs.splice((dayIndex + i * 7) % subs.length, 1)[0])
  }
  const results = await Promise.allSettled(
    picked.map(async (src) => {
      // Reddit公開JSON API(認証不要)
      const url = `https://www.reddit.com/r/${src.subreddit}/top.json?t=day&limit=${maxPerSub * 2}`
      const res = await fetchWithTimeout(url, { 'User-Agent': 'Mozilla/5.0 (compatible; RikoBot/1.0; +https://example.com)' })
      if (!res) throw new Error(`fetch failed: r/${src.subreddit}`)
      const data: any = await res.json()
      const posts = (data?.data?.children || []) as any[]
      return posts
        .map((p) => p.data)
        .filter((d) => d && d.ups >= Math.min(src.min_upvotes, 50) && !d.stickied)
        .slice(0, maxPerSub)
        .map((d): RawItem => ({
          title: d.title,
          url: `https://www.reddit.com${d.permalink}`,
          source: `r/${src.subreddit}`,
          score: d.ups,
          summary: (d.selftext || '').slice(0, 300),
        }))
    })
  )
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value)
    else errors.push(`Reddit r/${picked[i].subreddit}: ${r.reason?.message || 'error'}`)
  })
  return { items, errors }
}

import type { NewsCategory } from '@/services/db'

export interface OnlineNewsInput {
  category: NewsCategory
  title: string
  summary: string
  source: string
  url: string
  publishedAt?: string
}

/**
 * Real Persian news feeds.
 *
 * The public outlets do not publish per-section RSS endpoints, so the app
 * reads their general feeds and classifies every headline locally with
 * transparent keyword rules. Nothing is invented: every row comes from a
 * real feed of a real outlet.
 */
export const DEFAULT_FEEDS: Array<{
  url: string
  source: string
  pool: NewsCategory[]
}> = [
  {
    url: 'https://www.zoomit.ir/feed/',
    source: 'Zoomit',
    pool: ['ai', 'technology'],
  },
  {
    url: 'https://www.irna.ir/rss',
    source: 'ایرنا',
    pool: ['politics', 'economy', 'sports'],
  },
  {
    url: 'https://www.isna.ir/rss',
    source: 'ایسنا',
    pool: ['politics', 'economy', 'sports'],
  },
  {
    url: 'https://www.mehrnews.com/rss',
    source: 'مهر',
    pool: ['politics', 'economy', 'sports'],
  },
  {
    url: 'https://www.ettelaat.com/fa/rss',
    source: 'عتیق',
    pool: ['politics', 'economy'],
  },
]

/** Keyword rules that map a Persian headline to one of the product categories. */
const CATEGORY_KEYWORDS: Array<{ category: NewsCategory; words: string[] }> = [
  {
    category: 'ai',
    words: [
      'هوش مصنوعی',
      'یادگیری ماشین',
      'یادگیری عمیق',
      'مدل زبانی',
      'پردازش زبان',
      'الگوریتم',
      'chatgpt',
      'openai',
      'گوگل',
      'مایکروسافت',
      'دیتا ساینس',
      'ماشین‌لرنینگ',
    ],
  },
  {
    category: 'sports',
    words: [
      'ورزش',
      'فوتبال',
      'فوتسال',
      'بسکتبال',
      'والیبال',
      'تیم',
      'لیگ',
      'جام قهرمانی',
      'المپیک',
      'مدال',
      'ستاره',
      'مسابقه',
      'مربی',
      'ورزشکار',
    ],
  },
  {
    category: 'economy',
    words: [
      'اقتصاد',
      'بازار',
      'بورس',
      'سکه',
      'طلا',
      'ارز',
      'بانک',
      'صادرات',
      'واردات',
      'تولید',
      'صنعت',
      'کسب‌وکار',
      'قیمت',
      'تورم',
      'بودجه',
      'سرمایه‌گذاری',
    ],
  },
  {
    category: 'politics',
    words: [
      'سیاسی',
      'رئیس‌جمهور',
      'رییس‌جمهور',
      'مجلس',
      'دولت',
      'وزیر',
      'کابینه',
      'شورای نگهبان',
      'معاون',
      'استعفا',
      'انتصاب',
      'سخنرانی',
      'مذاکره',
      'تحریم',
      'حزب',
    ],
  },
  {
    category: 'technology',
    words: [
      'فناوری',
      'تکنولوژی',
      'نرم‌افزار',
      'اپلیکیشن',
      'گوشی',
      'مایکروویو',
      'اینترنت',
      'سخت‌افزار',
      'برنامه‌نویسی',
      'پایتون',
      'لینوکس',
      'گیت‌هاب',
    ],
  },
]

/** Normalises Persian/Arabic digits and lowercases the text for matching. */
export function normalizeHeadline(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[ً-ٟ‌]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Detects the category of a headline with transparent keyword rules.
 * Returns `undefined` when no rule matches, so unrelated headlines are not
 * forced into a category.
 */
export function classifyNews(
  title: string,
  summary = ''
): NewsCategory | undefined {
  const text = normalizeHeadline(`${title} ${summary}`)
  if (!text) return undefined
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.words.some((word) => text.includes(normalizeHeadline(word)))) {
      return rule.category
    }
  }
  return undefined
}

function textOf(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function dateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : undefined
}

interface ParsedFeedItem {
  title: string
  link: string
  summary: string
  date?: string
}

function parseFeedXml(
  xml: string,
  fallbackSource: string
): { source: string; items: ParsedFeedItem[] } {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const feedTitle = document
    .querySelector('channel > title, feed > title')
    ?.textContent?.trim()
  const entries = [...document.querySelectorAll('item, entry')]
  const items = entries
    .map((entry) => {
      const title = entry.querySelector('title')?.textContent?.trim() ?? ''
      const rawLink =
        entry.querySelector('link')?.textContent?.trim() ||
        entry.querySelector('link')?.getAttribute('href') ||
        ''
      const rawSummary =
        entry.querySelector('description, summary, content')?.textContent ?? ''
      const date =
        entry.querySelector('pubDate, updated, published')?.textContent ??
        undefined
      return {
        title,
        link: rawLink,
        summary: textOf(rawSummary).slice(0, 400),
        date,
      }
    })
    .filter((entry) => entry.title && entry.link)
  return { source: feedTitle || fallbackSource, items }
}

/** Reads a feed through the public JSON bridge (used when CORS blocks the direct request). */
async function fetchViaRss2Json(
  feedUrl: string
): Promise<{ source: string; items: ParsedFeedItem[] }> {
  const response = await fetch(
    `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`,
    { signal: AbortSignal.timeout(15_000) }
  )
  if (!response.ok) throw new Error(`RSS bridge returned ${response.status}`)
  const payload = (await response.json()) as {
    status?: string
    feed?: { title?: string }
    items?: Array<{
      title?: string
      link?: string
      description?: string
      pubDate?: string
    }>
  }
  if (payload.status !== 'ok')
    throw new Error('RSS bridge could not read this feed')
  return {
    source: payload.feed?.title?.trim() || new URL(feedUrl).hostname,
    items: (payload.items ?? [])
      .filter((item) => item.title && item.link)
      .map((item) => ({
        title: item.title ?? '',
        link: item.link ?? '',
        summary: textOf(item.description ?? '').slice(0, 400),
        date: item.pubDate,
      })),
  }
}

/** Reads one feed directly and falls back to the public bridge when CORS blocks it. */
export async function readFeed(
  feedUrl: string
): Promise<{ source: string; items: ParsedFeedItem[] }> {
  const parsed = new URL(feedUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('feed URL must use HTTP or HTTPS')
  }
  try {
    const response = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error(`feed returned ${response.status}`)
    const result = parseFeedXml(await response.text(), parsed.hostname)
    if (result.items.length === 0)
      throw new Error('feed contains no readable items')
    return result
  } catch {
    return fetchViaRss2Json(feedUrl)
  }
}

/** Items older than this are ignored, so old headlines are not shown as new. */
const MAX_AGE_DAYS = 21

function isFresh(publishedAt?: string): boolean {
  if (!publishedAt) return true
  const time = Date.parse(`${publishedAt}T00:00:00Z`)
  if (!Number.isFinite(time)) return true
  const ageDays = (Date.now() - time) / 86_400_000
  return ageDays <= MAX_AGE_DAYS
}

/**
 * Fetches the default Persian feeds and classifies every headline.
 * Items are returned with the category detected from their text.
 */
export async function fetchPersianNews(): Promise<OnlineNewsInput[]> {
  const results = await Promise.allSettled(
    DEFAULT_FEEDS.map((feed) => readFeed(feed.url))
  )
  const rows: OnlineNewsInput[] = []
  const seen = new Set<string>()

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return
    const feed = DEFAULT_FEEDS[index]!
    for (const item of result.value.items) {
      if (seen.has(item.link)) continue
      seen.add(item.link)
      const publishedAt = dateOnly(item.date)
      if (!isFresh(publishedAt)) continue
      const category = classifyNews(item.title, item.summary)
      if (!category) continue
      if (!feed.pool.includes(category)) continue
      rows.push({
        category,
        title: item.title,
        summary: item.summary,
        source: feed.source,
        url: item.link,
        publishedAt,
      })
    }
  })

  return rows
}

/** Fetches a user supplied feed and stores it in the selected category. */
export async function fetchOnlineNews(
  category: NewsCategory,
  feedUrl?: string
): Promise<OnlineNewsInput[]> {
  if (!feedUrl?.trim()) {
    throw new Error('NO_DEFAULT_FEED')
  }
  const feed = await readFeed(feedUrl.trim())
  return feed.items
    .filter((item) => isFresh(dateOnly(item.date)))
    .map((item) => ({
      category,
      title: item.title,
      summary: item.summary,
      source: feed.source,
      url: item.link,
      publishedAt: dateOnly(item.date),
    }))
}

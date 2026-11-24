import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Archive,
  Bookmark,
  CloudDownload,
  HardDrive,
  LoaderCircle,
  Newspaper,
  Plus,
  RotateCcw,
  Trash2,
  Wifi,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatJalaliDateKey } from '@/lib/jalali'
import { openExternal } from '@/lib/open-external'
import {
  deleteNewsItem,
  getNewsItems,
  NEWS_CATEGORIES,
  saveNewsItem,
  updateNewsItem,
  type NewsItem,
} from '@/services/db'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { HeaderActions } from '@/components/header-actions'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { fetchOnlineNews, fetchPersianNews } from '@/features/news/feed'

const categories = [...NEWS_CATEGORIES]

export function NewsRadarPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<NewsItem[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [category, setCategory] = useState<NewsItem['category']>('ai')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [source, setSource] = useState('')
  const [url, setUrl] = useState('')
  const [publishedAt, setPublishedAt] = useState('')
  const [error, setError] = useState('')
  const [originFilter, setOriginFilter] = useState<'all' | 'local' | 'online'>(
    'all'
  )
  const [feedUrl, setFeedUrl] = useState('')
  const [feedBusy, setFeedBusy] = useState(false)
  const [feedStatus, setFeedStatus] = useState('')

  const reload = async () =>
    setItems(await getNewsItems({ includeArchived: true }))

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    void reload().catch(() => setError(t('news.loadError')))
  }, [t])

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    try {
      await saveNewsItem({
        category,
        title,
        summary,
        source,
        url,
        ...(publishedAt ? { publishedAt } : {}),
      })
      setTitle('')
      setSummary('')
      setSource('')
      setUrl('')
      setPublishedAt('')
      await reload()
    } catch {
      setError(t('news.saveError'))
    }
  }

  const setFlag = async (
    item: NewsItem,
    patch: Partial<Pick<NewsItem, 'bookmarked' | 'archived'>>
  ) => {
    const updated = await updateNewsItem(item.id, patch)
    setItems((all) => all.map((row) => (row.id === updated.id ? updated : row)))
  }

  const fetchDefaultFeeds = async () => {
    setFeedBusy(true)
    setError('')
    setFeedStatus('')
    try {
      const online = await fetchPersianNews()
      for (const item of online) {
        await saveNewsItem({ ...item, origin: 'online' })
      }
      await reload()
      setFeedStatus(t('news.feedAdded', { count: online.length }))
    } catch {
      setFeedStatus(t('news.feedError'))
    } finally {
      setFeedBusy(false)
    }
  }

  const fetchFeed = async () => {
    setFeedBusy(true)
    setError('')
    setFeedStatus('')
    try {
      const online = await fetchOnlineNews(category, feedUrl)
      for (const item of online) {
        await saveNewsItem({ ...item, origin: 'online' })
      }
      await reload()
      setFeedStatus(t('news.feedAdded', { count: online.length }))
    } catch (cause) {
      setFeedStatus(
        cause instanceof Error && cause.message === 'NO_DEFAULT_FEED'
          ? t('news.noDefaultFeed')
          : t('news.feedError')
      )
    } finally {
      setFeedBusy(false)
    }
  }

  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (showArchived ? item.archived : !item.archived) &&
            item.category === category &&
            (originFilter === 'all' || item.origin === originFilter)
        )
        .sort((a, b) => {
          const left = a.publishedAt ?? a.createdAt.slice(0, 10)
          const right = b.publishedAt ?? b.createdAt.slice(0, 10)
          return right.localeCompare(left)
        }),
    [items, category, originFilter, showArchived]
  )

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('news.title')}</h2>
          <p className='text-muted-foreground'>{t('news.localOnly')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <CloudDownload className='size-5' />
              {t('news.onlineTitle')}
            </CardTitle>
            <CardDescription>{t('news.onlineHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='flex flex-wrap gap-2'>
              <Button
                disabled={feedBusy}
                onClick={() => void fetchDefaultFeeds()}
              >
                {feedBusy ? (
                  <LoaderCircle className='me-2 size-4 animate-spin' />
                ) : (
                  <CloudDownload className='me-2 size-4' />
                )}
                {t('news.fetchPersian')}
              </Button>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Input
                className='min-w-56 flex-1'
                type='url'
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
                placeholder={t('news.feedUrlPlaceholder')}
                aria-label={t('news.feedUrl')}
              />
              <Button
                variant='outline'
                disabled={feedBusy || !feedUrl.trim()}
                onClick={() => void fetchFeed()}
              >
                {t('news.fetchFeed')}
              </Button>
            </div>
            {feedStatus ? (
              <p role='status' className='text-sm text-muted-foreground'>
                {feedStatus}
              </p>
            ) : null}
            <p className='text-xs text-muted-foreground'>
              {t('news.onlineDisclosure')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Plus className='size-5' />
              {t('news.addItem')}
            </CardTitle>
            <CardDescription>{t('news.manualEntry')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className='grid gap-3 md:grid-cols-2'
              onSubmit={(event) => void add(event)}
            >
              <Input
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('news.headline')}
              />
              <select
                aria-label={t('news.category')}
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as NewsItem['category'])
                }
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {t(`news.categories.${item}`)}
                  </option>
                ))}
              </select>
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={t('news.sourceOptional')}
              />
              <Input
                type='url'
                aria-label={t('news.urlOptional')}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder='https://…'
              />
              <JalaliDatePicker
                value={publishedAt}
                onChange={setPublishedAt}
                ariaLabel={t('news.publishedAt')}
                clearable
              />
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder={t('news.summaryOptional')}
              />
              <Button type='submit'>{t('news.save')}</Button>
              {error ? (
                <p
                  role='alert'
                  className='self-center text-sm text-destructive'
                >
                  {error}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t(showArchived ? 'news.archive' : 'news.feed')}
            </CardTitle>
            <CardDescription>{t('news.categoryHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <Tabs
              value={category}
              onValueChange={(value) =>
                setCategory(value as NewsItem['category'])
              }
            >
              <TabsList className='grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4'>
                {categories.map((item) => (
                  <TabsTrigger key={item} value={item}>
                    {t(`news.categories.${item}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setShowArchived(!showArchived)}
              >
                <Archive className='me-2 size-4' />
                {t(showArchived ? 'news.showFeed' : 'news.showArchive')}
              </Button>
              <Button
                variant={originFilter === 'all' ? 'secondary' : 'outline'}
                size='sm'
                onClick={() => setOriginFilter('all')}
              >
                <Newspaper className='me-2 size-4' />
                {t('news.origin.all')}
              </Button>
              <Button
                variant={originFilter === 'local' ? 'secondary' : 'outline'}
                size='sm'
                onClick={() => setOriginFilter('local')}
              >
                <HardDrive className='me-2 size-4' />
                {t('news.origin.local')}
              </Button>
              <Button
                variant={originFilter === 'online' ? 'secondary' : 'outline'}
                size='sm'
                onClick={() => setOriginFilter('online')}
              >
                <Wifi className='me-2 size-4' />
                {t('news.origin.online')}
              </Button>
            </div>
            {visible.length ? (
              visible.map((item) => (
                <article key={item.id} className='rounded-lg border p-4'>
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div className='min-w-48 flex-1'>
                      <div className='mb-2 flex flex-wrap items-center gap-2'>
                        <Badge variant='secondary'>
                          {t(`news.categories.${item.category}`)}
                        </Badge>
                        <Badge variant='outline' className='gap-1'>
                          {item.origin === 'online' ? (
                            <Wifi className='size-3' />
                          ) : (
                            <HardDrive className='size-3' />
                          )}
                          {t(`news.origin.${item.origin}`)}
                        </Badge>
                        {item.source ? (
                          <span className='text-xs text-muted-foreground'>
                            {item.source}
                          </span>
                        ) : null}
                      </div>
                      <h3 className='font-semibold'>{item.title}</h3>
                      {item.publishedAt ? (
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {t('news.publishedAt')}:{' '}
                          {formatJalaliDateKey(item.publishedAt)}
                        </p>
                      ) : null}
                      {item.url ? (
                        <a
                          className='mt-1 inline-block text-sm text-primary underline'
                          href={item.url}
                          target='_blank'
                          rel='noreferrer'
                          onClick={(event) => {
                            event.preventDefault()
                            openExternal(item.url ?? '')
                          }}
                        >
                          {t('news.openSource')}
                        </a>
                      ) : null}
                      {item.summary ? (
                        <p className='mt-2 text-sm whitespace-pre-wrap text-muted-foreground'>
                          {item.summary}
                        </p>
                      ) : null}
                    </div>
                    <div className='flex gap-1'>
                      <Button
                        size='icon'
                        variant={item.bookmarked ? 'secondary' : 'ghost'}
                        aria-label={t(
                          item.bookmarked ? 'news.unbookmark' : 'news.bookmark'
                        )}
                        onClick={() =>
                          void setFlag(item, { bookmarked: !item.bookmarked })
                        }
                      >
                        <Bookmark className='size-4' />
                      </Button>
                      <Button
                        size='icon'
                        variant='ghost'
                        aria-label={t(
                          item.archived ? 'news.restore' : 'news.archiveAction'
                        )}
                        onClick={() =>
                          void setFlag(item, { archived: !item.archived })
                        }
                      >
                        {item.archived ? (
                          <RotateCcw className='size-4' />
                        ) : (
                          <Archive className='size-4' />
                        )}
                      </Button>
                      <Button
                        size='icon'
                        variant='ghost'
                        aria-label={t('news.delete')}
                        onClick={() =>
                          void deleteNewsItem(item.id).then(() =>
                            setItems((all) =>
                              all.filter((row) => row.id !== item.id)
                            )
                          )
                        }
                      >
                        <Trash2 className='size-4' />
                      </Button>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <p className='flex items-center gap-2 text-sm text-muted-foreground'>
                <Newspaper className='size-4' />
                {t(showArchived ? 'news.emptyArchive' : 'news.emptyFeed')}
              </p>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}

export function NewsRadarWidget() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<NewsItem[]>([])

  useEffect(() => {
    void getNewsItems()
      .then(setRows)
      .catch(() => undefined)
  }, [])

  const newest = rows[0]

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Newspaper className='size-5 text-sky-600' />
          {t('news.title')}
        </CardTitle>
        <CardDescription>
          {t('news.widgetHint', { count: rows.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {newest ? (
          <>
            <Badge variant='outline'>
              {t(`news.categories.${newest.category}`)}
            </Badge>
            <p className='mt-2 text-sm font-medium'>{newest.title}</p>
          </>
        ) : (
          <p className='text-sm text-muted-foreground'>{t('news.emptyFeed')}</p>
        )}
        <a
          className='mt-3 inline-block text-sm text-primary underline'
          href='/news'
        >
          {t('news.openRadar')}
        </a>
      </CardContent>
    </Card>
  )
}

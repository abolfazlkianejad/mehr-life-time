import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, FileText, LoaderCircle, Plus, Share2, Sparkles, Trash2, X } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { HeaderActions } from '@/components/header-actions'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { TimePicker24 } from '@/components/time-picker-24'
import {
  deleteSocialActivity,
  getSocialActivities,
  saveSocialActivity,
  updateSocialActivity,
  SOCIAL_PLATFORMS,
  type SocialActivity,
  type SocialPlatform,
  type SocialStatus,
} from '@/services/social'
import {
  deleteSocialDraft,
  getSocialDrafts,
  getStudyLogsByRange,
  getTimelineBlocksByRange,
  getWorkSessionsByRange,
  saveSocialDraft,
  type SocialDraft,
} from '@/services/db'
import { isAiConfigured, requestAiText } from '@/features/ai/client'
import { formatJalaliDateKey } from '@/lib/jalali'
import { clockDateFromParts, clockTimeFromDate, formatClockTime } from '@/lib/time'

interface Achievement {
  id: string
  title: string
  source: string
}

const monthBounds = () => {
  const now = new Date()
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  }
}

export function SocialPage() {
  const { t, i18n } = useTranslation()
  const [activities, setActivities] = useState<SocialActivity[]>([])
  const [drafts, setDrafts] = useState<SocialDraft[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [platform, setPlatform] = useState<SocialPlatform>('instagram')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<SocialStatus>('planned')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('18:00')
  const [checklist, setChecklist] = useState<{ id: string; text: string; done: boolean }[]>([])
  const [checklistInput, setChecklistInput] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [filter, setFilter] = useState<'all' | SocialStatus>('all')
  const [suggestion, setSuggestion] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [draftPlatform, setDraftPlatform] = useState<SocialDraft['platform']>('linkedin')
  const [achievementId, setAchievementId] = useState('')
  const [draftText, setDraftText] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const { start, end } = monthBounds()
    const [savedActivities, savedDrafts, blocks, sessions, studyLogs] = await Promise.all([
      getSocialActivities(),
      getSocialDrafts(),
      getTimelineBlocksByRange(start, end),
      getWorkSessionsByRange(start, end),
      getStudyLogsByRange(start, end),
    ])
    const items: Achievement[] = [
      ...blocks
        .filter((block) => block.status === 'completed')
        .map((block) => ({ id: `timeline:${block.id}`, title: block.title, source: t('social.timelineAchievement') })),
      ...sessions.map((session) => ({
        id: `work:${session.id}`,
        title: `${session.clientName} · ${session.taskType}`,
        source: t('social.workAchievement'),
      })),
      ...studyLogs
        .filter((log) => log.note.trim())
        .map((log) => ({ id: `study:${log.id}`, title: log.note.trim(), source: t('social.studyAchievement') })),
    ]
    setActivities(savedActivities)
    setDrafts(savedDrafts)
    setAchievements(items)
    setAchievementId((current) => current || items[0]?.id || '')
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    void load().catch(() => setError(t('social.loadError')))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only depends on the translator
  }, [t])

  const resetForm = () => {
    setEditingId(undefined)
    setTitle('')
    setDescription('')
    setStatus('planned')
    setScheduledDate('')
    setScheduledTime('18:00')
    setChecklist([])
    setChecklistInput('')
    setSuggestion('')
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!title.trim()) {
      setError(t('social.validationError'))
      return
    }
    const scheduled = scheduledDate
      ? clockDateFromParts(scheduledDate, scheduledTime)
      : null
    const scheduledAt = scheduled ? scheduled.toISOString() : undefined
    try {
      const saved = await saveSocialActivity({
        ...(editingId ? { id: editingId } : {}),
        platform,
        title,
        description,
        status,
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(scheduledDate ? { scheduledDate } : {}),
        checklist,
      })
      setActivities((all) => [saved, ...all.filter((row) => row.id !== saved.id)])
      resetForm()
    } catch {
      setError(t('social.saveError'))
    }
  }

  const edit = (activity: SocialActivity) => {
    setEditingId(activity.id)
    setPlatform(activity.platform)
    setTitle(activity.title)
    setDescription(activity.description)
    setStatus(activity.status)
    setScheduledDate(activity.scheduledDate ?? '')
    setScheduledTime(
      activity.scheduledAt
        ? clockTimeFromDate(new Date(activity.scheduledAt))
        : '18:00'
    )
    setChecklist(activity.checklist)
    setSuggestion('')
  }

  const changeStatus = async (activity: SocialActivity, next: SocialStatus) => {
    try {
      const updated = await updateSocialActivity(activity.id, { status: next })
      setActivities((all) => all.map((row) => (row.id === updated.id ? updated : row)))
    } catch {
      setError(t('social.saveError'))
    }
  }

  const toggleCheck = async (activity: SocialActivity, itemId: string) => {
    const next = activity.checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item
    )
    try {
      const updated = await updateSocialActivity(activity.id, { checklist: next })
      setActivities((all) => all.map((row) => (row.id === updated.id ? updated : row)))
    } catch {
      setError(t('social.saveError'))
    }
  }

  const remove = async (id: string) => {
    try {
      await deleteSocialActivity(id)
      setActivities((all) => all.filter((row) => row.id !== id))
    } catch {
      setError(t('social.saveError'))
    }
  }

  const addChecklistItem = () => {
    if (!checklistInput.trim()) return
    setChecklist((all) => [
      ...all,
      { id: crypto.randomUUID(), text: checklistInput.trim(), done: false },
    ])
    setChecklistInput('')
  }

  const suggest = async () => {
    setError('')
    setMessage('')
    if (!title.trim() && !description.trim()) {
      setError(t('social.validationError'))
      return
    }
    setSuggesting(true)
    try {
      const text = await requestAiText(
        [
          'You help write short social media posts.',
          `Platform: ${platform}`,
          `Topic: ${title}`,
          description ? `Details: ${description}` : 'No extra details.',
          'Write a short, honest post in Persian. Do not invent facts or numbers.',
        ].join('\n'),
        { system: 'You write concise, factual social media drafts in Persian.' }
      )
      setSuggestion(text)
    } catch {
      setMessage(t('social.aiUnavailable'))
    } finally {
      setSuggesting(false)
    }
  }

  const saveDraft = async () => {
    const chosen = achievements.find((item) => item.id === achievementId)
    if (!chosen) {
      setMessage(t('social.noAchievement'))
      return
    }
    try {
      const saved = await saveSocialDraft({
        platform: draftPlatform,
        achievementId: chosen.id,
        achievementTitle: chosen.title,
        text: draftText,
      })
      setDrafts((all) => [saved, ...all.filter((draft) => draft.id !== saved.id)])
      setMessage(t('social.savedNotice'))
    } catch {
      setError(t('social.saveError'))
    }
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setMessage(t('social.copied'))
    } catch {
      setError(t('social.copyError'))
    }
  }

  const visible = filter === 'all' ? activities : activities.filter((row) => row.status === filter)

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('social.title')}</h2>
          <p className='text-muted-foreground'>{t('social.subtitle')}</p>
        </div>

        {error ? <p role='alert' className='text-sm text-destructive'>{error}</p> : null}
        {message ? <p role='status' className='text-sm text-muted-foreground'>{message}</p> : null}

        <Tabs defaultValue='activities'>
          <TabsList className='grid h-auto w-full grid-cols-2'>
            <TabsTrigger value='activities'>{t('social.activitiesTab')}</TabsTrigger>
            <TabsTrigger value='drafts'>{t('social.draftsTab')}</TabsTrigger>
          </TabsList>

          <TabsContent value='activities' className='mt-4 space-y-4'>
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <Plus className='size-5' />
                  {editingId ? t('social.editActivity') : t('social.addActivity')}
                </CardTitle>
                <CardDescription>{t('social.activityHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form className='grid gap-3 md:grid-cols-2 xl:grid-cols-4' onSubmit={(event) => void save(event)}>
                  <select
                    aria-label={t('social.platform')}
                    className='h-9 rounded-md border bg-background px-3 text-sm'
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value as SocialPlatform)}
                  >
                    {SOCIAL_PLATFORMS.map((item) => (
                      <option key={item} value={item}>
                        {t(`social.platforms.${item}`)}
                      </option>
                    ))}
                  </select>
                  <Input
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={t('social.titlePlaceholder')}
                  />
                  <select
                    aria-label={t('social.status')}
                    className='h-9 rounded-md border bg-background px-3 text-sm'
                    value={status}
                    onChange={(event) => setStatus(event.target.value as SocialStatus)}
                  >
                    {(['planned', 'in_progress', 'done'] as const).map((item) => (
                      <option key={item} value={item}>
                        {t(`social.statuses.${item}`)}
                      </option>
                    ))}
                  </select>
                  <div className='flex gap-2'>
                    <JalaliDatePicker
                      value={scheduledDate}
                      onChange={setScheduledDate}
                      ariaLabel={t('social.scheduledDate')}
                    />
                    <TimePicker24
                      className='w-32'
                      value={scheduledTime}
                      onChange={setScheduledTime}
                      ariaLabel={t('social.scheduledTime')}
                    />
                  </div>
                  <Textarea
                    className='md:col-span-2 xl:col-span-4'
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t('social.descriptionPlaceholder')}
                  />
                  <div className='md:col-span-2 xl:col-span-4'>
                    <p className='mb-1 text-sm font-medium'>{t('social.checklist')}</p>
                    <div className='space-y-1'>
                      {checklist.map((item) => (
                        <div key={item.id} className='flex items-center gap-2 text-sm'>
                          <Checkbox
                            checked={item.done}
                            onCheckedChange={() =>
                              setChecklist((all) =>
                                all.map((entry) =>
                                  entry.id === item.id ? { ...entry, done: !entry.done } : entry
                                )
                              )
                            }
                          />
                          <span className={item.done ? 'text-muted-foreground line-through' : ''}>{item.text}</span>
                          <Button
                            size='icon'
                            variant='ghost'
                            aria-label={t('social.removeChecklistItem')}
                            onClick={() => setChecklist((all) => all.filter((entry) => entry.id !== item.id))}
                          >
                            <X className='size-4' />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className='mt-2 flex gap-2'>
                      <Input
                        value={checklistInput}
                        onChange={(event) => setChecklistInput(event.target.value)}
                        placeholder={t('social.checklistPlaceholder')}
                      />
                      <Button type='button' variant='outline' onClick={addChecklistItem}>
                        {t('social.addChecklistItem')}
                      </Button>
                    </div>
                  </div>
                  <div className='flex flex-wrap gap-2 md:col-span-2 xl:col-span-4'>
                    <Button type='submit'>
                      <Share2 className='me-2 size-4' />
                      {editingId ? t('social.updateActivity') : t('social.saveActivity')}
                    </Button>
                    <Button type='button' variant='outline' disabled={suggesting} onClick={() => void suggest()}>
                      {suggesting ? <LoaderCircle className='me-2 size-4 animate-spin' /> : <Sparkles className='me-2 size-4' />}
                      {t('social.suggestText')}
                    </Button>
                    {editingId ? (
                      <Button type='button' variant='ghost' onClick={resetForm}>
                        {t('social.cancel')}
                      </Button>
                    ) : null}
                    {!isAiConfigured() ? (
                      <span className='self-center text-xs text-muted-foreground'>{t('social.aiNotConfigured')}</span>
                    ) : null}
                  </div>
                </form>

                {suggestion ? (
                  <div className='mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3'>
                    <p className='mb-2 text-sm font-medium'>{t('social.suggestionTitle')}</p>
                    <p className='whitespace-pre-wrap text-sm'>{suggestion}</p>
                    <div className='mt-2 flex gap-2'>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => {
                          setDescription(suggestion)
                          setSuggestion('')
                        }}
                      >
                        {t('social.useSuggestion')}
                      </Button>
                      <Button size='sm' variant='ghost' onClick={() => setSuggestion('')}>
                        {t('social.discardSuggestion')}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <p className='mt-3 text-xs text-muted-foreground'>{t('social.noPublish')}</p>
              </CardContent>
            </Card>

            <div className='flex flex-wrap gap-2'>
              <Button variant={filter === 'all' ? 'secondary' : 'outline'} size='sm' onClick={() => setFilter('all')}>
                {t('social.allActivities')}
              </Button>
              {(['planned', 'in_progress', 'done'] as const).map((item) => (
                <Button
                  key={item}
                  variant={filter === item ? 'secondary' : 'outline'}
                  size='sm'
                  onClick={() => setFilter(item)}
                >
                  {t(`social.statuses.${item}`)}
                </Button>
              ))}
            </div>

            {visible.length ? (
              <div className='grid gap-3 lg:grid-cols-2'>
                {visible.map((activity) => (
                  <Card key={activity.id}>
                    <CardHeader>
                      <div className='flex flex-wrap items-start justify-between gap-2'>
                        <div>
                          <CardTitle className='text-base'>{activity.title}</CardTitle>
                          <CardDescription>
                            {t(`social.platforms.${activity.platform}`)}
                            {activity.scheduledDate ? ` · ${formatJalaliDateKey(activity.scheduledDate)} ${activity.scheduledAt ? formatClockTime(new Date(activity.scheduledAt), i18n.language) : ''}` : ''}
                          </CardDescription>
                        </div>
                        <Badge variant={activity.status === 'done' ? 'secondary' : 'outline'}>
                          {t(`social.statuses.${activity.status}`)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                      {activity.description ? (
                        <p className='whitespace-pre-wrap text-sm text-muted-foreground'>{activity.description}</p>
                      ) : null}
                      {activity.checklist.length ? (
                        <div className='space-y-1'>
                          {activity.checklist.map((item) => (
                            <label key={item.id} className='flex items-center gap-2 text-sm'>
                              <Checkbox
                                checked={item.done}
                                onCheckedChange={() => void toggleCheck(activity, item.id)}
                              />
                              <span className={item.done ? 'text-muted-foreground line-through' : ''}>{item.text}</span>
                            </label>
                          ))}
                        </div>
                      ) : null}
                      <div className='flex flex-wrap gap-2'>
                        {activity.status !== 'done' ? (
                          <Button size='sm' variant='outline' onClick={() => void changeStatus(activity, 'done')}>
                            <Check className='me-2 size-4' />
                            {t('social.markDone')}
                          </Button>
                        ) : (
                          <Button size='sm' variant='outline' onClick={() => void changeStatus(activity, 'planned')}>
                            {t('social.reopen')}
                          </Button>
                        )}
                        <Button size='sm' variant='outline' onClick={() => edit(activity)}>
                          {t('social.edit')}
                        </Button>
                        {activity.description ? (
                          <Button size='sm' variant='outline' onClick={() => void copyText(activity.description)}>
                            <Copy className='me-2 size-4' />
                            {t('social.copy')}
                          </Button>
                        ) : null}
                        <Button size='icon' variant='ghost' aria-label={t('social.delete')} onClick={() => void remove(activity.id)}>
                          <Trash2 className='size-4' />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>{t('social.emptyActivities')}</p>
            )}
          </TabsContent>

          <TabsContent value='drafts' className='mt-4 space-y-4'>
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <FileText className='size-5' />
                  {t('social.newDraft')}
                </CardTitle>
                <CardDescription>{t('social.localOnly')}</CardDescription>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='grid gap-3 sm:grid-cols-2'>
                  <select
                    aria-label={t('social.achievement')}
                    className='h-9 rounded-md border bg-background px-3 text-sm'
                    value={achievementId}
                    onChange={(event) => setAchievementId(event.target.value)}
                  >
                    <option value=''>{t('social.chooseAchievement')}</option>
                    {achievements.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} · {item.source}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t('social.platform')}
                    className='h-9 rounded-md border bg-background px-3 text-sm'
                    value={draftPlatform}
                    onChange={(event) => setDraftPlatform(event.target.value as SocialDraft['platform'])}
                  >
                    <option value='linkedin'>LinkedIn</option>
                    <option value='x'>X</option>
                  </select>
                </div>
                <Textarea
                  rows={6}
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  placeholder={t('social.draftPlaceholder')}
                />
                <Button onClick={() => void saveDraft()}>{t('social.saveDraft')}</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('social.savedDrafts')}</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                {drafts.length ? (
                  drafts.map((draft) => (
                    <div key={draft.id} className='rounded-lg border p-3'>
                      <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
                        <div className='flex items-center gap-2'>
                          <Badge variant='secondary'>{draft.platform === 'linkedin' ? 'LinkedIn' : 'X'}</Badge>
                          <span className='text-sm font-medium'>{draft.achievementTitle}</span>
                        </div>
                        <div className='flex gap-1'>
                          <Button size='sm' variant='outline' onClick={() => void copyText(draft.text)}>
                            <Copy className='me-2 size-4' />
                            {t('social.copy')}
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
                            aria-label={t('social.delete')}
                            onClick={() =>
                              void deleteSocialDraft(draft.id).then(() =>
                                setDrafts((all) => all.filter((row) => row.id !== draft.id))
                              )
                            }
                          >
                            <Trash2 className='size-4' />
                          </Button>
                        </div>
                      </div>
                      <p className='whitespace-pre-wrap text-sm text-muted-foreground'>{draft.text}</p>
                    </div>
                  ))
                ) : (
                  <p className='text-sm text-muted-foreground'>{t('social.empty')}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}

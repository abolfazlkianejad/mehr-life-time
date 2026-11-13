import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  CheckCheck,
  ExternalLink,
  ListChecks,
  Pencil,
  Plus,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import type { LearningTrack } from '@/services/db'
import {
  detachCourseFromEducationTasks,
  educationElapsedSeconds,
  type EducationTask,
} from '@/services/education'
import {
  deleteEducationItem,
  educationItemCreatedTime,
  saveEducationItem,
  type EducationItem,
  type EducationItemStatus,
} from '@/services/learning'
import {
  displayTaskStatus,
  formatEducationCreatedAt,
  formatStudyDuration,
} from './education-utils'

const TRACK_HINT_KEY: Record<LearningTrack, string> = {
  masters: 'learning.paths.mastersHint',
  university: 'learning.paths.universityHint',
  course: 'learning.paths.courseHint',
}

interface CourseFormState {
  id?: string
  title: string
  description: string
  status: EducationItemStatus
  progress: string
  credits: string
  professor: string
  semester: string
  instructor: string
  platform: string
  url: string
  estimatedHours: string
  resources: string
}

const emptyForm = (): CourseFormState => ({
  title: '',
  description: '',
  status: 'planned',
  progress: '0',
  credits: '',
  professor: '',
  semester: '',
  instructor: '',
  platform: '',
  url: '',
  estimatedHours: '',
  resources: '',
})

function formFromItem(item: EducationItem): CourseFormState {
  return {
    id: item.id,
    title: item.title,
    description: item.description ?? '',
    status: item.status,
    progress: String(item.progress),
    credits: item.credits === undefined ? '' : String(item.credits),
    professor: item.professor ?? '',
    semester: item.semester ?? '',
    instructor: item.instructor ?? '',
    platform: item.platform ?? '',
    url: item.url ?? '',
    estimatedHours: item.estimatedHours === undefined ? '' : String(item.estimatedHours),
    resources: item.resources ?? '',
  }
}

interface CoursePanelProps {
  track: LearningTrack
  items: EducationItem[]
  tasks: EducationTask[]
  now: number
  onChanged: () => Promise<void>
}

/**
 * Course management of one independent education path.
 *
 * Master's, university and training courses keep different fields but all live
 * in the same local store, so the shared task and report system can link to
 * any of them.
 */
export function CoursePanel({ track, items, tasks, now, onChanged }: CoursePanelProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<CourseFormState>(emptyForm)
  const [formError, setFormError] = useState('')
  const [formErrorDetail, setFormErrorDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)

  // Validation and storage errors stay next to the form; the technical detail
  // is shown as well so a failure is never silently swallowed.
  const showError = (message: string, error?: unknown) => {
    setFormError(message)
    setFormErrorDetail(
      error instanceof Error && error.message ? error.message : ''
    )
  }

  const trackItems = items
    .filter((item) => item.track === track)
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'active') return -1
        if (b.status === 'active') return 1
        if (a.status === 'planned' && b.status === 'completed') return -1
        if (b.status === 'planned' && a.status === 'completed') return 1
      }
      return educationItemCreatedTime(b) - educationItemCreatedTime(a)
    })
  const trackTasks = tasks.filter((task) => task.track === track)
  const openTasks = trackTasks.filter((task) => displayTaskStatus(task) !== 'completed')
  const studiedSeconds = trackTasks.reduce(
    (total, task) => total + educationElapsedSeconds(task, now),
    0
  )

  // Functional updates keep rapid typing and IME composition from overwriting
  // a field with a stale copy of the form.
  const set = (patch: Partial<CourseFormState>) =>
    setForm((current) => ({ ...current, ...patch }))

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    showError('')
    if (!form.title.trim()) {
      showError(t('learning.paths.invalidTitle'))
      return
    }
    let credits: number | undefined
    if (track === 'university') {
      const creditsText = form.credits.trim()
      credits = Number(creditsText)
      if (!creditsText || !Number.isInteger(credits) || credits < 0 || credits > 60) {
        showError(t('learning.paths.invalidCredits'))
        return
      }
    }
    let estimatedHours: number | undefined
    if (track === 'course' && form.estimatedHours.trim()) {
      estimatedHours = Number(form.estimatedHours)
      if (!Number.isFinite(estimatedHours) || estimatedHours < 0) {
        showError(t('learning.paths.invalid'))
        return
      }
    }
    const progress = Number(form.progress || 0)
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      showError(t('learning.paths.invalid'))
      return
    }
    const url = form.url.trim()
    if (track === 'course' && url) {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new RangeError('unsupported protocol')
        }
      } catch {
        showError(t('learning.paths.invalidUrl'))
        return
      }
    }
    // The ref is synchronous, so a double click can not write two records.
    savingRef.current = true
    setSaving(true)
    try {
      await saveEducationItem({
        ...(form.id ? { id: form.id } : {}),
        track,
        type: 'course',
        title: form.title.trim(),
        description: form.description.trim(),
        status: form.status,
        progress,
        ...(track === 'masters' ? { resources: form.resources.trim() } : {}),
        ...(track === 'university'
          ? {
              credits,
              professor: form.professor.trim(),
              semester: form.semester.trim(),
            }
          : {}),
        ...(track === 'course'
          ? {
              instructor: form.instructor.trim(),
              platform: form.platform.trim(),
              url,
              ...(estimatedHours !== undefined ? { estimatedHours } : {}),
            }
          : {}),
      })
      setForm(emptyForm())
      showError('')
      await onChanged()
    } catch (error) {
      showError(t('learning.errors.save'), error)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const edit = (item: EducationItem) => {
    setForm(formFromItem(item))
    showError('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const remove = async (item: EducationItem) => {
    if (savingRef.current) return
    showError('')
    const linked = tasks.filter((task) => task.courseId === item.id).length
    const message = linked
      ? t('learning.paths.confirmDeleteLinked', { count: linked })
      : t('learning.paths.confirmDelete')
    if (!window.confirm(message)) return
    savingRef.current = true
    setSaving(true)
    try {
      if (linked) await detachCourseFromEducationTasks(item.id)
      await deleteEducationItem(item.id)
      if (form.id === item.id) setForm(emptyForm())
      await onChanged()
    } catch (error) {
      showError(t('learning.errors.save'), error)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const statusBadge = (item: EducationItem) => (
    <Badge variant={item.status === 'completed' ? 'secondary' : 'outline'}>
      {t(`learning.courseStatuses.${item.status}`)}
    </Badge>
  )

  return (
    <div className='grid gap-4 lg:grid-cols-3'>
      <Card className='lg:col-span-1'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <BookOpen className='size-5' />
            {t(form.id ? 'learning.paths.formTitleEdit' : 'learning.paths.formTitleAdd')}
          </CardTitle>
          <CardDescription>{t(TRACK_HINT_KEY[track])}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            ref={formRef}
            noValidate
            className='grid gap-3'
            onSubmit={(event) => void save(event)}
          >
            <fieldset
              disabled={saving}
              className='m-0 grid min-w-0 gap-3 border-0 p-0'
            >
            <Input
              value={form.title}
              onChange={(event) => set({ title: event.target.value })}
              aria-label={t('learning.paths.name')}
              placeholder={t('learning.paths.namePlaceholder')}
            />
            <Textarea
              rows={2}
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
              aria-label={t('learning.paths.description')}
              placeholder={t('learning.paths.descriptionPlaceholder')}
            />
            {track === 'masters' ? (
              <Textarea
                rows={2}
                value={form.resources}
                onChange={(event) => set({ resources: event.target.value })}
                aria-label={t('learning.paths.resources')}
                placeholder={t('learning.paths.resourcesPlaceholder')}
              />
            ) : null}
            {track === 'university' ? (
              <div className='grid gap-3 sm:grid-cols-2'>
                <Input
                  type='number'
                  min='0'
                  max='60'
                  value={form.credits}
                  onChange={(event) => set({ credits: event.target.value })}
                  aria-label={t('learning.paths.credits')}
                  placeholder={t('learning.paths.credits')}
                />
                <Input
                  value={form.semester}
                  onChange={(event) => set({ semester: event.target.value })}
                  aria-label={t('learning.paths.semester')}
                  placeholder={t('learning.paths.semesterPlaceholder')}
                />
                <Input
                  className='sm:col-span-2'
                  value={form.professor}
                  onChange={(event) => set({ professor: event.target.value })}
                  aria-label={t('learning.paths.professor')}
                  placeholder={t('learning.paths.professorPlaceholder')}
                />
              </div>
            ) : null}
            {track === 'course' ? (
              <div className='grid gap-3 sm:grid-cols-2'>
                <Input
                  value={form.instructor}
                  onChange={(event) => set({ instructor: event.target.value })}
                  aria-label={t('learning.paths.instructor')}
                  placeholder={t('learning.paths.instructorPlaceholder')}
                />
                <Input
                  value={form.platform}
                  onChange={(event) => set({ platform: event.target.value })}
                  aria-label={t('learning.paths.platform')}
                  placeholder={t('learning.paths.platformPlaceholder')}
                />
                <Input
                  type='number'
                  min='0'
                  step='0.5'
                  value={form.estimatedHours}
                  onChange={(event) => set({ estimatedHours: event.target.value })}
                  aria-label={t('learning.paths.estimatedHours')}
                  placeholder={t('learning.paths.estimatedHours')}
                />
                <Input
                  type='number'
                  min='0'
                  max='100'
                  value={form.progress}
                  onChange={(event) => set({ progress: event.target.value })}
                  aria-label={t('learning.paths.progress')}
                  placeholder={t('learning.paths.progress')}
                />
                <Input
                  className='sm:col-span-2'
                  type='url'
                  value={form.url}
                  onChange={(event) => set({ url: event.target.value })}
                  aria-label={t('learning.paths.url')}
                  placeholder={t('learning.paths.urlPlaceholder')}
                  dir='ltr'
                />
              </div>
            ) : null}
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.paths.status')}
              value={form.status}
              onChange={(event) => set({ status: event.target.value as EducationItemStatus })}
            >
              {(['planned', 'active', 'completed'] as const).map((status) => (
                <option key={status} value={status}>
                  {t(`learning.courseStatuses.${status}`)}
                </option>
              ))}
            </select>
            {formError ? (
              <div role='alert' className='text-sm text-destructive'>
                <p>{formError}</p>
                {formErrorDetail ? (
                  <p dir='ltr' className='mt-1 text-xs text-muted-foreground'>
                    {formErrorDetail}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className='flex flex-wrap gap-2'>
              <Button type='submit'>
                <Plus className='me-2 size-4' />
                {saving
                  ? t('learning.paths.saving')
                  : t(form.id ? 'learning.paths.update' : 'learning.paths.add')}
              </Button>
              {form.id ? (
                <Button type='button' variant='outline' onClick={() => setForm(emptyForm())}>
                  <X className='me-2 size-4' />
                  {t('learning.paths.cancel')}
                </Button>
              ) : null}
            </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>

      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle>{t('learning.paths.coursesTitle')}</CardTitle>
          <CardDescription>
            {t('learning.paths.pathSummary', {
              courses: trackItems.length,
              open: openTasks.length,
              time: formatStudyDuration(studiedSeconds),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {trackItems.length ? (
            trackItems.map((item) => {
              const linked = tasks.filter((task) => task.courseId === item.id)
              const completed = linked.filter((task) => task.status === 'completed').length
              const seconds = linked.reduce(
                (total, task) => total + educationElapsedSeconds(task, now),
                0
              )
              return (
                <div key={item.id} className='rounded-lg border p-3'>
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>{item.title || '—'}</span>
                      {statusBadge(item)}
                      <Badge variant='outline'>
                        {t(`learning.tracks.${item.track}`)}
                      </Badge>
                    </div>
                    <div className='flex gap-1'>
                      <Button
                        size='icon'
                        variant='ghost'
                        aria-label={t('learning.paths.edit')}
                        onClick={() => edit(item)}
                      >
                        <Pencil className='size-4' />
                      </Button>
                      <Button
                        size='icon'
                        variant='ghost'
                        aria-label={t('learning.paths.delete')}
                        onClick={() => void remove(item)}
                      >
                        <Trash2 className='size-4' />
                      </Button>
                    </div>
                  </div>

                  <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                    {item.credits !== undefined ? (
                      <span>
                        {t('learning.paths.credits')}: {item.credits}{' '}
                        {t('learning.paths.creditsUnit')}
                      </span>
                    ) : null}
                    {item.professor ? (
                      <span>
                        {t('learning.paths.professor')}: {item.professor}
                      </span>
                    ) : null}
                    {item.semester ? (
                      <span>
                        {t('learning.paths.semester')}: {item.semester}
                      </span>
                    ) : null}
                    {item.instructor ? (
                      <span>
                        {t('learning.paths.instructor')}: {item.instructor}
                      </span>
                    ) : null}
                    {item.platform ? (
                      <span>
                        {t('learning.paths.platform')}: {item.platform}
                      </span>
                    ) : null}
                    {item.estimatedHours !== undefined ? (
                      <span>
                        {t('learning.paths.estimatedHours')}: {item.estimatedHours}{' '}
                        {t('learning.paths.hoursUnit')}
                      </span>
                    ) : null}
                    {item.track === 'course' ? (
                      <span>
                        {t('learning.paths.progress')}: {item.progress}%
                      </span>
                    ) : null}
                    <span>
                      {t('learning.paths.createdAt')}:{' '}
                      {formatEducationCreatedAt(item.createdAt)}
                    </span>
                  </div>

                  {item.resources ? (
                    <p className='mt-2 text-sm'>
                      <span className='font-medium'>{t('learning.paths.resources')}: </span>
                      {item.resources}
                    </p>
                  ) : null}
                  {item.description ? (
                    <p className='mt-1 text-sm text-muted-foreground'>{item.description}</p>
                  ) : null}
                  {item.url ? (
                    <a
                      className='mt-2 inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline'
                      href={item.url}
                      target='_blank'
                      rel='noreferrer'
                    >
                      <ExternalLink className='size-3.5' />
                      <span dir='ltr' className='truncate'>
                        {item.url}
                      </span>
                    </a>
                  ) : null}

                  <div className='mt-3 flex flex-wrap gap-2'>
                    <Badge variant='outline' className='gap-1'>
                      <ListChecks className='size-3.5' />
                      {t('learning.paths.linkedTasks')}: {linked.length}
                    </Badge>
                    <Badge variant='outline' className='gap-1'>
                      <CheckCheck className='size-3.5' />
                      {t('learning.paths.completedTasks')}: {completed}
                    </Badge>
                    <Badge variant='secondary' className='gap-1 font-mono tabular-nums'>
                      <Timer className='size-3.5' />
                      {formatStudyDuration(seconds)}
                    </Badge>
                  </div>
                </div>
              )
            })
          ) : (
            <div className='rounded-lg border border-dashed p-6 text-center'>
              <p className='text-sm font-medium'>{t('learning.paths.empty')}</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {t('learning.paths.emptyHint')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

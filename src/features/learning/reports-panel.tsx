import { useMemo, useState } from 'react'
import { Clock3, Pencil, RotateCcw, Search, Timer, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LearningTrack } from '@/services/db'
import {
  deleteEducationReport,
  updateEducationReport,
  type EducationReport,
} from '@/services/education'
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
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import {
  filterEducationReports,
  formatStudyDuration,
  reportCourseOptions,
  type EducationReportFilters,
  type EducationReportSort,
} from './education-utils'
import {
  ProgressReportForm,
  ReportBody,
  reportDraftFrom,
  reportTimestamp,
  type ReportDraft,
} from './report-components'

const TRACKS: LearningTrack[] = ['masters', 'university', 'course']

interface ReportsPanelProps {
  reports: EducationReport[]
  onChanged: () => Promise<void>
  onError: (message: string) => void
}

/** Aggregated, filterable history of the progress reports of all three paths. */
export function ReportsPanel({
  reports,
  onChanged,
  onError,
}: ReportsPanelProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const [filters, setFilters] = useState<EducationReportFilters>({
    track: 'all',
    courseId: 'all',
    from: '',
    to: '',
    query: '',
    sort: 'newest',
  })
  const [editingId, setEditingId] = useState<string>()

  const courseOptions = useMemo(() => {
    const scoped =
      filters.track === 'all'
        ? reports
        : reports.filter((report) => report.track === filters.track)
    return reportCourseOptions(scoped)
  }, [reports, filters.track])

  const filtered = useMemo(
    () => filterEducationReports(reports, filters),
    [reports, filters]
  )
  const hasFilters =
    filters.track !== 'all' ||
    filters.courseId !== 'all' ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.query.trim() !== '' ||
    filters.sort !== 'newest'
  const editing = reports.find((report) => report.id === editingId)

  const changePath = (track: 'all' | LearningTrack) => {
    setFilters({ ...filters, track, courseId: 'all' })
  }

  const update = async (report: EducationReport, draft: ReportDraft) => {
    onError('')
    try {
      await updateEducationReport(report.id, draft)
      setEditingId(undefined)
      await onChanged()
    } catch {
      onError(t('learning.errors.save'))
    }
  }

  const remove = async (report: EducationReport) => {
    if (!window.confirm(t('learning.reports.confirmDelete'))) return
    onError('')
    try {
      await deleteEducationReport(report.id)
      if (editingId === report.id) setEditingId(undefined)
      await onChanged()
    } catch {
      onError(t('learning.errors.save'))
    }
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('learning.reports.title')}</CardTitle>
          <CardDescription>{t('learning.reports.hint')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
            <div className='relative sm:col-span-2'>
              <Search className='pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground' />
              <Input
                className='ps-8'
                value={filters.query}
                onChange={(event) =>
                  setFilters({ ...filters, query: event.target.value })
                }
                aria-label={t('learning.reports.filters.search')}
                placeholder={t('learning.reports.filters.searchPlaceholder')}
              />
            </div>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.reports.filters.path')}
              value={filters.track}
              onChange={(event) =>
                changePath(event.target.value as 'all' | LearningTrack)
              }
            >
              <option value='all'>
                {t('learning.reports.filters.allPaths')}
              </option>
              {TRACKS.map((track) => (
                <option key={track} value={track}>
                  {t(`learning.tracks.${track}`)}
                </option>
              ))}
            </select>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.reports.filters.course')}
              value={filters.courseId}
              onChange={(event) =>
                setFilters({ ...filters, courseId: event.target.value })
              }
            >
              <option value='all'>
                {t('learning.reports.filters.allCourses')}
              </option>
              {courseOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title || t('learning.tasks.noCourse')}
                </option>
              ))}
            </select>
            <JalaliDatePicker
              clearable
              value={filters.from}
              onChange={(dateKey) => setFilters({ ...filters, from: dateKey })}
              ariaLabel={t('learning.reports.filters.from')}
            />
            <JalaliDatePicker
              clearable
              value={filters.to}
              onChange={(dateKey) => setFilters({ ...filters, to: dateKey })}
              ariaLabel={t('learning.reports.filters.to')}
            />
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.reports.filters.sort')}
              value={filters.sort}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  sort: event.target.value as EducationReportSort,
                })
              }
            >
              <option value='newest'>
                {t('learning.reports.filters.sortNewest')}
              </option>
              <option value='oldest'>
                {t('learning.reports.filters.sortOldest')}
              </option>
            </select>
            {hasFilters ? (
              <Button
                type='button'
                variant='outline'
                onClick={() =>
                  setFilters({
                    track: 'all',
                    courseId: 'all',
                    from: '',
                    to: '',
                    query: '',
                    sort: 'newest',
                  })
                }
              >
                <RotateCcw className='me-2 size-4' />
                {t('learning.reports.filters.clear')}
              </Button>
            ) : null}
          </div>
          <p className='text-xs text-muted-foreground'>
            {t(
              filtered.length === 1
                ? 'learning.reports.count'
                : 'learning.reports.countMany',
              { count: filtered.length }
            )}
          </p>
        </CardContent>
      </Card>

      {filtered.length ? (
        <div className='space-y-3'>
          {filtered.map((report) => (
            <Card key={report.id}>
              <CardHeader className='pb-2'>
                <div className='flex flex-wrap items-start justify-between gap-2'>
                  <div className='min-w-0'>
                    <CardTitle className='text-base'>
                      {report.taskTitle}
                    </CardTitle>
                    <div className='mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                      <span className='inline-flex items-center gap-1'>
                        <Clock3 className='size-3.5' />
                        {reportTimestamp(report, language)}
                      </span>
                      <Badge variant='outline'>
                        {t(`learning.tracks.${report.track}`)}
                      </Badge>
                      <Badge variant='secondary'>
                        {report.courseTitle ?? t('learning.tasks.noCourse')}
                      </Badge>
                      <Badge variant='outline'>
                        {t('learning.reports.statusAtReport')}:{' '}
                        {t(`learning.taskStatuses.${report.taskStatus}`)}
                      </Badge>
                      <Badge
                        variant='secondary'
                        className='font-mono tabular-nums'
                      >
                        <Timer className='me-1 size-3.5' />
                        {formatStudyDuration(report.durationSeconds)}
                      </Badge>
                    </div>
                  </div>
                  <div className='flex gap-1'>
                    {editingId === report.id ? null : (
                      <Button
                        size='icon'
                        variant='ghost'
                        aria-label={t('learning.reports.edit')}
                        onClick={() => setEditingId(report.id)}
                      >
                        <Pencil className='size-4' />
                      </Button>
                    )}
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label={t('learning.reports.delete')}
                      onClick={() => void remove(report)}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editing?.id === report.id ? (
                  <ProgressReportForm
                    key={report.id}
                    initial={reportDraftFrom(report)}
                    submitLabel={t('learning.reportForm.update')}
                    onSubmit={(draft) => update(report, draft)}
                    onCancel={() => setEditingId(undefined)}
                  />
                ) : (
                  <ReportBody report={report} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className='rounded-lg border border-dashed p-8 text-center'>
          <p className='text-sm font-medium'>{t('learning.reports.empty')}</p>
          <p className='mt-1 text-xs text-muted-foreground'>
            {t('learning.reports.emptyHint')}
          </p>
        </div>
      )}
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatJalaliDateKey } from '@/lib/jalali'
import { formatClockTime } from '@/lib/time'
import type { EducationReport } from '@/services/education'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export interface ReportDraft {
  summary: string
  topics: string
  exercises: string
  problems: string
  resumePoint: string
}

export const emptyReportDraft = (): ReportDraft => ({
  summary: '',
  topics: '',
  exercises: '',
  problems: '',
  resumePoint: '',
})

export function reportDraftFrom(report: EducationReport): ReportDraft {
  return {
    summary: report.summary,
    topics: report.topics ?? '',
    exercises: report.exercises ?? '',
    problems: report.problems ?? '',
    resumePoint: report.resumePoint ?? '',
  }
}

interface ProgressReportFormProps {
  initial?: ReportDraft
  submitLabel: string
  onSubmit: (draft: ReportDraft) => Promise<void> | void
  onCancel?: () => void
}

/** Shared add/edit form used by both the task history and the reports tab. */
export function ProgressReportForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: ProgressReportFormProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ReportDraft>(initial ?? emptyReportDraft)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.summary.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(draft)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className='space-y-3' onSubmit={(event) => void submit(event)}>
      <div>
        <span className='mb-1 block text-xs font-medium text-muted-foreground'>
          {t('learning.reportForm.summary')}
        </span>
        <Textarea
          required
          rows={2}
          aria-label={t('learning.reportForm.summary')}
          value={draft.summary}
          onChange={(event) =>
            setDraft({ ...draft, summary: event.target.value })
          }
          placeholder={t('learning.reportForm.summaryPlaceholder')}
        />
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div>
          <span className='mb-1 block text-xs font-medium text-muted-foreground'>
            {t('learning.reportForm.topics')}
          </span>
          <Textarea
            rows={2}
            aria-label={t('learning.reportForm.topics')}
            value={draft.topics}
            onChange={(event) =>
              setDraft({ ...draft, topics: event.target.value })
            }
            placeholder={t('learning.reportForm.topicsPlaceholder')}
          />
        </div>
        <div>
          <span className='mb-1 block text-xs font-medium text-muted-foreground'>
            {t('learning.reportForm.exercises')}
          </span>
          <Textarea
            rows={2}
            aria-label={t('learning.reportForm.exercises')}
            value={draft.exercises}
            onChange={(event) =>
              setDraft({ ...draft, exercises: event.target.value })
            }
            placeholder={t('learning.reportForm.exercisesPlaceholder')}
          />
        </div>
        <div>
          <span className='mb-1 block text-xs font-medium text-muted-foreground'>
            {t('learning.reportForm.problems')}
          </span>
          <Textarea
            rows={2}
            aria-label={t('learning.reportForm.problems')}
            value={draft.problems}
            onChange={(event) =>
              setDraft({ ...draft, problems: event.target.value })
            }
            placeholder={t('learning.reportForm.problemsPlaceholder')}
          />
        </div>
        <div>
          <span className='mb-1 block text-xs font-medium text-muted-foreground'>
            {t('learning.reportForm.resume')}
          </span>
          <Textarea
            rows={2}
            aria-label={t('learning.reportForm.resume')}
            value={draft.resumePoint}
            onChange={(event) =>
              setDraft({ ...draft, resumePoint: event.target.value })
            }
            placeholder={t('learning.reportForm.resumePlaceholder')}
          />
        </div>
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button
          type='submit'
          size='sm'
          disabled={!draft.summary.trim() || submitting}
        >
          <Save className='me-2 size-4' />
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type='button' size='sm' variant='outline' onClick={onCancel}>
            <X className='me-2 size-4' />
            {t('learning.reportForm.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/** Jalali day plus 24-hour time of a report. */
export function reportTimestamp(
  report: EducationReport,
  language: string
): string {
  return `${formatJalaliDateKey(report.dateKey)} · ${formatClockTime(
    new Date(report.createdAt),
    language
  )}`
}

/** Read-only body shared by the task history and the reports tab. */
export function ReportBody({ report }: { report: EducationReport }) {
  const { t } = useTranslation()
  const sections = [
    {
      key: 'topics',
      label: t('learning.reportForm.topics'),
      value: report.topics,
    },
    {
      key: 'exercises',
      label: t('learning.reportForm.exercises'),
      value: report.exercises,
    },
    {
      key: 'problems',
      label: t('learning.reportForm.problems'),
      value: report.problems,
    },
    {
      key: 'resume',
      label: t('learning.reportForm.resume'),
      value: report.resumePoint,
    },
  ].filter((section) => section.value)
  return (
    <div className='space-y-2 text-sm'>
      <p>{report.summary}</p>
      {sections.length ? (
        <dl className='grid gap-2 sm:grid-cols-2'>
          {sections.map((section) => (
            <div key={section.key} className='rounded-md bg-muted/40 p-2'>
              <dt className='text-xs font-medium text-muted-foreground'>
                {section.label}
              </dt>
              <dd className='whitespace-pre-wrap'>{section.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

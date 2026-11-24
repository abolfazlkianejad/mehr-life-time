import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  LoaderCircle,
  Trash2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatClockTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  clearAllData,
  countBackupRecords,
  createBackup,
  getStorageEstimate,
  parseBackup,
  restoreBackup,
  type DatabaseBackup,
  type StorageEstimate,
} from '@/services/backup'
import { getStoreCounts, STORE_DEFINITIONS } from '@/services/db'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ContentSection } from '../components/content-section'

/** Backups are plain JSON; anything much larger is rejected before parsing. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024

type BusyAction = 'export' | 'import' | 'reset'
type Status = { kind: 'success' | 'error'; text: string }

function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'byte',
      unitDisplay: 'short',
      maximumFractionDigits: 0,
    }).format(bytes)
  }
  if (bytes < 1024 ** 2) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'kilobyte',
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(bytes / 1024)
  }
  if (bytes < 1024 ** 3) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'megabyte',
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(bytes / 1024 ** 2)
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'gigabyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(bytes / 1024 ** 3)
}

export function DataSettingsPage() {
  const { t, i18n } = useTranslation()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [pendingBackup, setPendingBackup] = useState<DatabaseBackup | null>(
    null
  )
  const [resetOpen, setResetOpen] = useState(false)
  const [busy, setBusy] = useState<BusyAction | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const locale = i18n.language === 'fa' ? 'fa-IR' : 'en-US'
  const numberFormat = new Intl.NumberFormat(locale)
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

  const refresh = useCallback(async () => {
    const [nextCounts, nextEstimate] = await Promise.all([
      getStoreCounts(),
      getStorageEstimate(),
    ])
    setCounts(nextCounts)
    setEstimate(nextEstimate)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [nextCounts, nextEstimate] = await Promise.all([
          getStoreCounts(),
          getStorageEstimate(),
        ])
        if (!active) return
        setCounts(nextCounts)
        setEstimate(nextEstimate)
      } catch {
        if (active) setStatus({ kind: 'error', text: t('data.loadError') })
      }
    })()
    return () => {
      active = false
    }
  }, [t])

  const totalRecords = Object.values(counts).reduce(
    (total, count) => total + count,
    0
  )

  const runExport = async () => {
    setStatus(null)
    setBusy('export')
    try {
      const backup = await createBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `mehr-life-backup-${backup.createdAt.slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus({
        kind: 'success',
        text: t('data.exportDone', { count: countBackupRecords(backup) }),
      })
    } catch {
      setStatus({ kind: 'error', text: t('data.exportError') })
    } finally {
      setBusy(null)
    }
  }

  const selectFile = async (file: File | undefined) => {
    if (!file) return
    setStatus(null)
    if (file.size > MAX_BACKUP_BYTES) {
      setStatus({ kind: 'error', text: t('data.importTooLarge') })
      return
    }
    setBusy('import')
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new RangeError('The file does not contain valid JSON')
      }
      // Validation happens before the confirmation, so an invalid file never
      // reaches the database and the current data stays untouched.
      setPendingBackup(parseBackup(parsed))
    } catch {
      setStatus({ kind: 'error', text: t('data.importError') })
    } finally {
      setBusy(null)
    }
  }

  const runImport = async () => {
    const backup = pendingBackup
    setPendingBackup(null)
    if (!backup) return
    setStatus(null)
    setBusy('import')
    try {
      const restored = await restoreBackup(backup)
      await refresh()
      setStatus({
        kind: 'success',
        text: t('data.importDone', { count: restored }),
      })
    } catch {
      setStatus({ kind: 'error', text: t('data.importFailed') })
    } finally {
      setBusy(null)
    }
  }

  const runReset = async () => {
    setResetOpen(false)
    setStatus(null)
    setBusy('reset')
    try {
      await clearAllData()
      await refresh()
      setStatus({ kind: 'success', text: t('data.resetDone') })
    } catch {
      setStatus({ kind: 'error', text: t('data.resetError') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <ContentSection title={t('data.title')} desc={t('data.subtitle')}>
      <div className='space-y-5'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Database className='size-5' />
              {t('data.storage')}
            </CardTitle>
            <CardDescription>{t('data.storageHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium'>
              <span>{t('data.totalRecords')}</span>
              <strong className='tabular-nums'>
                {numberFormat.format(totalRecords)}
              </strong>
            </div>
            <div className='grid gap-2 sm:grid-cols-2'>
              {STORE_DEFINITIONS.map((definition) => {
                const count = counts[definition.name] ?? 0
                return (
                  <div
                    key={definition.name}
                    className='flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm'
                  >
                    <span className='truncate'>
                      {t(`data.stores.${definition.name}`)}
                    </span>
                    <strong
                      className={cn(
                        'tabular-nums',
                        count === 0 && 'font-normal text-muted-foreground'
                      )}
                    >
                      {numberFormat.format(count)}
                    </strong>
                  </div>
                )
              })}
            </div>
            <p className='flex items-center gap-2 text-xs text-muted-foreground'>
              <HardDrive className='size-4 shrink-0' />
              {estimate?.usageBytes != null
                ? t('data.usageValue', {
                    usage: formatBytes(estimate.usageBytes, locale),
                    quota:
                      estimate.quotaBytes != null
                        ? formatBytes(estimate.quotaBytes, locale)
                        : '—',
                  })
                : t('data.usageUnavailable')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Download className='size-5' />
              {t('data.backupTitle')}
            </CardTitle>
            <CardDescription>{t('data.backupHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='flex flex-wrap gap-2'>
              <Button disabled={busy !== null} onClick={() => void runExport()}>
                {busy === 'export' ? (
                  <LoaderCircle className='me-2 size-4 animate-spin' />
                ) : (
                  <Download className='me-2 size-4' />
                )}
                {t('data.export')}
              </Button>
              <Button
                variant='outline'
                disabled={busy !== null}
                onClick={() => fileInput.current?.click()}
              >
                {busy === 'import' ? (
                  <LoaderCircle className='me-2 size-4 animate-spin' />
                ) : (
                  <Upload className='me-2 size-4' />
                )}
                {t('data.import')}
              </Button>
              <Button
                variant='destructive'
                disabled={busy !== null}
                onClick={() => setResetOpen(true)}
              >
                {busy === 'reset' ? (
                  <LoaderCircle className='me-2 size-4 animate-spin' />
                ) : (
                  <Trash2 className='me-2 size-4' />
                )}
                {t('data.reset')}
              </Button>
              <input
                ref={fileInput}
                type='file'
                accept='application/json,.json'
                className='hidden'
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void selectFile(file)
                  event.target.value = ''
                }}
              />
            </div>
            {status ? (
              <Alert
                variant={status.kind === 'error' ? 'destructive' : 'default'}
                role={status.kind === 'error' ? 'alert' : 'status'}
              >
                {status.kind === 'error' ? <AlertCircle /> : <CheckCircle2 />}
                <AlertDescription
                  className={cn(status.kind === 'success' && 'text-foreground')}
                >
                  {status.text}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <AlertDialog
          open={pendingBackup !== null}
          onOpenChange={(open) => {
            if (!open) setPendingBackup(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('data.importTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('data.importConfirm')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {pendingBackup ? (
              <dl className='grid gap-1 rounded-md border p-3 text-sm'>
                <div className='flex items-center justify-between gap-3'>
                  <dt className='text-muted-foreground'>
                    {t('data.importCreatedAt')}
                  </dt>
                  <dd>
                    {dateFormat.format(new Date(pendingBackup.createdAt))} ·{' '}
                    {formatClockTime(
                      new Date(pendingBackup.createdAt),
                      i18n.language
                    )}
                  </dd>
                </div>
                <div className='flex items-center justify-between gap-3'>
                  <dt className='text-muted-foreground'>
                    {t('data.importRecords')}
                  </dt>
                  <dd className='tabular-nums'>
                    {numberFormat.format(countBackupRecords(pendingBackup))}
                  </dd>
                </div>
                <div className='flex items-center justify-between gap-3'>
                  <dt className='text-muted-foreground'>
                    {t('data.importStores')}
                  </dt>
                  <dd className='tabular-nums'>
                    {numberFormat.format(
                      Object.keys(pendingBackup.stores).length
                    )}
                  </dd>
                </div>
              </dl>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>{t('data.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void runImport()}>
                {t('data.importAction')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('data.resetTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('data.resetConfirm')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('data.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => void runReset()}
              >
                {t('data.resetAction')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ContentSection>
  )
}

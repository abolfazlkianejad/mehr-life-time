import { createId } from '@/lib/id'
import {
  getDatabase,
  isLearningTrack,
  STORE_EDUCATION_ITEMS,
  type LearningTrack,
} from '@/services/db'
import {
  deleteRecords,
  getAllFromIndex,
  getAllRecords,
  getRecord,
  putRecords,
} from '@/services/idb'

/**
 * Learning tracks are fully independent: every subject, topic or course lives
 * in exactly one track and progress is reported per track.
 */
export const LEARNING_ITEM_TYPES = [
  'subject',
  'topic',
  'course',
  'assignment',
] as const
export type LearningItemType = (typeof LEARNING_ITEM_TYPES)[number]

export const LEARNING_ITEM_STATUSES = [
  'planned',
  'active',
  'completed',
] as const
export type LearningItemStatus = (typeof LEARNING_ITEM_STATUSES)[number]

/** Alias kept for the UI layer. */
export type EducationItemType = LearningItemType
/** Alias kept for the UI layer. */
export type EducationItemStatus = LearningItemStatus

export interface EducationItem {
  id: string
  track: LearningTrack
  type: LearningItemType
  /** Course name for the three education paths. */
  title: string
  description?: string
  status: LearningItemStatus
  /** Manual progress in percent (0–100), mostly used by training courses. */
  progress: number
  /** Optional study goal in minutes. */
  targetMinutes?: number
  /** Optional deadline as a Gregorian day key. */
  dueDate?: string
  /** Master's path: books, papers or other study resources. */
  resources?: string
  /** University path: course credits. */
  credits?: number
  /** University path: professor name. */
  professor?: string
  /** University path: semester label, for example "نیم‌سال اول ۱۴۰۵". */
  semester?: string
  /** Training path: instructor or platform name. */
  instructor?: string
  /** Training path: separate platform name when the instructor differs. */
  platform?: string
  /** Training path: link to the course page. */
  url?: string
  /** Training path: estimated total study hours. */
  estimatedHours?: number
  createdAt: string
  updatedAt: string
}

export type EducationItemInput = Omit<
  EducationItem,
  'id' | 'createdAt' | 'updatedAt'
> & { id?: string }

/** Track names used by the very first learning prototype. */
const LEGACY_TRACK_ALIASES: Record<string, LearningTrack> = {
  ml: 'masters',
  exam: 'university',
  coding: 'course',
}

function assertTrack(track: unknown): LearningTrack {
  if (!isLearningTrack(track)) throw new RangeError('unknown learning track')
  return track
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

/** Coerces stored timestamps (ISO text or epoch milliseconds) to ISO text. */
function timestampOf(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return undefined
    return Number.isFinite(Date.parse(text)) ? text : undefined
  }
  return undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Repairs a stored course row before it reaches the UI.
 *
 * A single malformed or legacy record (for example a missing `createdAt` or an
 * old `ml`/`exam`/`coding` track) used to make the whole education page throw
 * while sorting. Reading is now defensive: valid records are normalized for
 * display, unknown rows are skipped, and the stored records are never changed.
 */
export function normalizeEducationItem(row: unknown): EducationItem | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return null
  const rawTrack = typeof value.track === 'string' ? value.track : ''
  const track = isLearningTrack(rawTrack)
    ? rawTrack
    : LEGACY_TRACK_ALIASES[rawTrack]
  if (!track) return null
  const createdAt =
    timestampOf(value.createdAt) ?? timestampOf(value.updatedAt) ?? ''
  const updatedAt = timestampOf(value.updatedAt) ?? createdAt
  const rawStatus = value.status as LearningItemStatus
  const rawType = value.type as LearningItemType
  const credits = finiteNumber(value.credits)
  const estimatedHours = finiteNumber(value.estimatedHours)
  const targetMinutes = finiteNumber(value.targetMinutes)
  const progress = finiteNumber(value.progress)
  return {
    id,
    track,
    type: LEARNING_ITEM_TYPES.includes(rawType) ? rawType : 'course',
    title: typeof value.title === 'string' ? value.title.trim() : '',
    ...(optionalText(
      typeof value.description === 'string' ? value.description : undefined
    )
      ? { description: optionalText(value.description as string) }
      : {}),
    status: LEARNING_ITEM_STATUSES.includes(rawStatus) ? rawStatus : 'planned',
    progress:
      progress === undefined
        ? 0
        : Math.max(0, Math.min(100, Math.round(progress))),
    ...(targetMinutes !== undefined &&
    Number.isInteger(targetMinutes) &&
    targetMinutes >= 0
      ? { targetMinutes }
      : {}),
    ...(typeof value.dueDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)
      ? { dueDate: value.dueDate }
      : {}),
    ...(optionalText(
      typeof value.resources === 'string' ? value.resources : undefined
    )
      ? { resources: optionalText(value.resources as string) }
      : {}),
    ...(credits !== undefined &&
    Number.isInteger(credits) &&
    credits >= 0 &&
    credits <= 60
      ? { credits }
      : {}),
    ...(optionalText(
      typeof value.professor === 'string' ? value.professor : undefined
    )
      ? { professor: optionalText(value.professor as string) }
      : {}),
    ...(optionalText(
      typeof value.semester === 'string' ? value.semester : undefined
    )
      ? { semester: optionalText(value.semester as string) }
      : {}),
    ...(optionalText(
      typeof value.instructor === 'string' ? value.instructor : undefined
    )
      ? { instructor: optionalText(value.instructor as string) }
      : {}),
    ...(optionalText(
      typeof value.platform === 'string' ? value.platform : undefined
    )
      ? { platform: optionalText(value.platform as string) }
      : {}),
    ...(optionalText(typeof value.url === 'string' ? value.url : undefined)
      ? { url: optionalText(value.url as string) }
      : {}),
    ...(estimatedHours !== undefined && estimatedHours >= 0
      ? { estimatedHours }
      : {}),
    createdAt,
    updatedAt,
  }
}

/** Sortable creation time; malformed legacy records sort first instead of throwing. */
export function educationItemCreatedTime(
  item: Pick<EducationItem, 'createdAt'>
): number {
  const time = Date.parse(item.createdAt)
  return Number.isFinite(time) ? time : 0
}

function buildItem(
  input: EducationItemInput,
  base?: EducationItem
): EducationItem {
  const track = assertTrack(input.track)
  if (!input.title.trim()) throw new RangeError('title is required')
  if (!LEARNING_ITEM_TYPES.includes(input.type))
    throw new RangeError('unknown learning item type')
  if (!LEARNING_ITEM_STATUSES.includes(input.status))
    throw new RangeError('unknown learning item status')
  const progress = Math.max(0, Math.min(100, Math.round(input.progress)))
  if (
    input.targetMinutes !== undefined &&
    (!Number.isInteger(input.targetMinutes) || input.targetMinutes < 0)
  ) {
    throw new RangeError('target minutes must be a non-negative whole number')
  }
  if (
    input.dueDate !== undefined &&
    !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
  ) {
    throw new RangeError('due date must use YYYY-MM-DD')
  }
  if (input.credits !== undefined) {
    if (
      !Number.isInteger(input.credits) ||
      input.credits < 0 ||
      input.credits > 60
    ) {
      throw new RangeError('credits must be a whole number between 0 and 60')
    }
  }
  if (input.estimatedHours !== undefined) {
    if (!Number.isFinite(input.estimatedHours) || input.estimatedHours < 0) {
      throw new RangeError('estimated hours must be a non-negative number')
    }
  }
  const url = optionalText(input.url)
  if (url) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new RangeError('course URL must use http or https')
      }
    } catch {
      throw new RangeError('course URL must be a valid http(s) link')
    }
  }
  const now = new Date().toISOString()
  return {
    id: base?.id ?? input.id ?? createId('edu'),
    track,
    type: input.type,
    title: input.title.trim(),
    ...(optionalText(input.description)
      ? { description: optionalText(input.description) }
      : {}),
    status: input.status,
    progress,
    ...(input.targetMinutes !== undefined
      ? { targetMinutes: input.targetMinutes }
      : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    ...(optionalText(input.resources)
      ? { resources: optionalText(input.resources) }
      : {}),
    ...(input.credits !== undefined ? { credits: input.credits } : {}),
    ...(optionalText(input.professor)
      ? { professor: optionalText(input.professor) }
      : {}),
    ...(optionalText(input.semester)
      ? { semester: optionalText(input.semester) }
      : {}),
    ...(optionalText(input.instructor)
      ? { instructor: optionalText(input.instructor) }
      : {}),
    ...(optionalText(input.platform)
      ? { platform: optionalText(input.platform) }
      : {}),
    ...(url ? { url } : {}),
    ...(input.estimatedHours !== undefined
      ? { estimatedHours: input.estimatedHours }
      : {}),
    createdAt: timestampOf(base?.createdAt) ?? now,
    updatedAt: now,
  }
}

/** Learning items of one track (or all tracks when omitted). */
export async function getEducationItems(
  track?: LearningTrack
): Promise<EducationItem[]> {
  const db = await getDatabase()
  const rows = track
    ? await getAllFromIndex<unknown>(
        db,
        STORE_EDUCATION_ITEMS,
        'by_track',
        track
      )
    : await getAllRecords<unknown>(db, STORE_EDUCATION_ITEMS)
  const items = rows
    .map((row) => normalizeEducationItem(row))
    .filter((item): item is EducationItem => item !== null)
  return items.sort(
    (a, b) =>
      a.track.localeCompare(b.track) ||
      educationItemCreatedTime(a) - educationItemCreatedTime(b)
  )
}

export async function getEducationItem(
  id: string
): Promise<EducationItem | undefined> {
  const db = await getDatabase()
  return getRecord<EducationItem>(db, STORE_EDUCATION_ITEMS, id)
}

export async function saveEducationItem(
  input: EducationItemInput
): Promise<EducationItem> {
  const db = await getDatabase()
  const base = input.id
    ? await getRecord<EducationItem>(db, STORE_EDUCATION_ITEMS, input.id)
    : undefined
  const record = buildItem(input, base)
  await putRecords(db, STORE_EDUCATION_ITEMS, [record])
  return record
}

export async function updateEducationItem(
  id: string,
  patch: Partial<EducationItemInput>
): Promise<EducationItem> {
  const db = await getDatabase()
  const stored = await getRecord<unknown>(db, STORE_EDUCATION_ITEMS, id)
  const base = stored ? normalizeEducationItem(stored) : null
  if (!base) throw new RangeError(`Learning item "${id}" does not exist`)
  const record = buildItem({ ...base, ...patch, id }, base)
  await putRecords(db, STORE_EDUCATION_ITEMS, [record])
  return record
}

export async function deleteEducationItem(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_EDUCATION_ITEMS, [id])
}

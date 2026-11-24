import { createId } from '@/lib/id'
import { getDatabase, STORE_SOCIAL_ACTIVITIES } from '@/services/db'
import {
  deleteRecords,
  getAllFromIndex,
  getAllRecords,
  getRecord,
  putRecords,
} from '@/services/idb'

export const SOCIAL_PLATFORMS = [
  'instagram',
  'linkedin',
  'x',
  'youtube',
  'telegram',
  'other',
] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export const SOCIAL_STATUSES = ['planned', 'in_progress', 'done'] as const
export type SocialStatus = (typeof SOCIAL_STATUSES)[number]

export interface SocialChecklistItem {
  id: string
  text: string
  done: boolean
}

/**
 * A social media activity: what to publish, where, when and what still has to
 * be done before publishing.
 */
export interface SocialActivity {
  id: string
  platform: SocialPlatform
  title: string
  description: string
  status: SocialStatus
  /** Optional scheduled publication time (ISO 8601, local time). */
  scheduledAt?: string
  /** Optional Gregorian day key of the planned publication day. */
  scheduledDate?: string
  checklist: SocialChecklistItem[]
  createdAt: string
  updatedAt: string
}

export type SocialActivityInput = Omit<
  SocialActivity,
  'id' | 'createdAt' | 'updatedAt'
> & { id?: string }

function buildActivity(
  input: SocialActivityInput,
  base?: SocialActivity
): SocialActivity {
  if (!input.title.trim()) throw new RangeError('title is required')
  if (!SOCIAL_PLATFORMS.includes(input.platform))
    throw new RangeError('unknown social platform')
  if (!SOCIAL_STATUSES.includes(input.status))
    throw new RangeError('unknown social status')
  if (
    input.scheduledDate !== undefined &&
    !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)
  ) {
    throw new RangeError('scheduled date must use YYYY-MM-DD')
  }
  const now = new Date().toISOString()
  return {
    id: base?.id ?? input.id ?? createId('social'),
    platform: input.platform,
    title: input.title.trim(),
    description: input.description.trim(),
    status: input.status,
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    ...(input.scheduledDate ? { scheduledDate: input.scheduledDate } : {}),
    checklist: input.checklist.map((item) => ({
      id: item.id,
      text: item.text.trim(),
      done: item.done,
    })),
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
  }
}

export async function getSocialActivities(): Promise<SocialActivity[]> {
  const db = await getDatabase()
  const rows = await getAllRecords<SocialActivity>(db, STORE_SOCIAL_ACTIVITIES)
  return [...rows].sort(
    (a, b) =>
      (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999') ||
      b.updatedAt.localeCompare(a.updatedAt)
  )
}

export async function getSocialActivitiesByStatus(
  status: SocialStatus
): Promise<SocialActivity[]> {
  const db = await getDatabase()
  const rows = await getAllFromIndex<SocialActivity>(
    db,
    STORE_SOCIAL_ACTIVITIES,
    'by_status',
    status
  )
  return [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function saveSocialActivity(
  input: SocialActivityInput
): Promise<SocialActivity> {
  const db = await getDatabase()
  const base = input.id
    ? await getRecord<SocialActivity>(db, STORE_SOCIAL_ACTIVITIES, input.id)
    : undefined
  const record = buildActivity(input, base)
  await putRecords(db, STORE_SOCIAL_ACTIVITIES, [record])
  return record
}

export async function updateSocialActivity(
  id: string,
  patch: Partial<SocialActivityInput>
): Promise<SocialActivity> {
  const db = await getDatabase()
  const base = await getRecord<SocialActivity>(db, STORE_SOCIAL_ACTIVITIES, id)
  if (!base) throw new RangeError(`Social activity "${id}" does not exist`)
  const record = buildActivity({ ...base, ...patch, id }, base)
  await putRecords(db, STORE_SOCIAL_ACTIVITIES, [record])
  return record
}

export async function deleteSocialActivity(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_SOCIAL_ACTIVITIES, [id])
}

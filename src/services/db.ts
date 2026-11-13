import { addDays } from 'date-fns'
import {
  isEnergyScore,
  isTaskPriority,
  type EnergyLog,
  type EnergyLogInput,
  type EnergyLogPatch,
  type EnergyLogRecord,
  type EnergyScore,
  type EnergyTrendPoint,
  type TaskPriority,
  type TimelineBlock,
  type TimelineBlockInput,
  type TimelineBlockPatch,
  type TimelineBlockRecord,
  type TimelineDaySummary,
} from '@/types/timeline'
import {
  type WorkSession,
  type WorkSessionFilter,
  type WorkSessionInput,
  type WorkSessionPatch,
  type WorkSessionRecord,
  type WorkTotals,
} from '@/types/work'
import { listDateKeys, toDate, toDateKey, toIsoString } from '@/lib/date-key'
import { createId } from '@/lib/id'
import {
  findNextFreeSlot,
  findWorkTaskConflict,
  intersectsLunch,
  nextDateKey,
} from '@/lib/work-schedule'
import { calculateWorkTime, settleTimelineBlockSeconds, timelineBlockSeconds } from '@/lib/work-time'
import {
  awaitTransaction,
  clearStores,
  countRecords,
  deleteDatabase,
  deleteRecords,
  getAllFromIndex,
  getAllRecords,
  getRecord,
  isIndexedDbAvailable,
  openDatabase,
  promisifyRequest,
  putRecords,
  type StoreDefinition,
} from '@/services/idb'
import { buildSeedBundle, type SeedBundle } from '@/services/seed'
import { migrateLegacyMeals } from '@/services/migrations'
import {
  STORE_BODY_WEIGHTS,
  STORE_CARDIO_LOGS,
  STORE_DASHBOARD_DAYS,
  STORE_DINNER_LOGS,
  STORE_EDUCATION_ITEMS,
  STORE_EDUCATION_REPORTS,
  STORE_EDUCATION_TASKS,
  STORE_ENERGY_LOGS,
  STORE_FINANCE_ENTRIES,
  STORE_FINANCE_SETTINGS,
  STORE_LEGACY_TASKS,
  STORE_MEAL_LOGS,
  STORE_META,
  STORE_NEWS_ITEMS,
  STORE_PROJECT_NOTES,
  STORE_PROJECTS,
  STORE_RADAR_ITEMS,
  STORE_RADAR_SAVED,
  STORE_SOCIAL_ACTIVITIES,
  STORE_SOCIAL_DRAFTS,
  STORE_STUDY_LOGS,
  STORE_STUDY_TIMERS,
  STORE_TIMELINE_BLOCKS,
  STORE_VITALS,
  STORE_WORKOUT_LOGS,
  STORE_WORK_SESSIONS,
} from '@/services/stores'

export const DB_NAME = 'mehr-life-os'
// v11 is additive only: opening a v10 database keeps every existing store and
// record, then creates the stores for education tasks and their progress
// reports. No destructive migration is used.
export const DB_VERSION = 11

export {
  STORE_BODY_WEIGHTS,
  STORE_CARDIO_LOGS,
  STORE_DASHBOARD_DAYS,
  STORE_DINNER_LOGS,
  STORE_EDUCATION_ITEMS,
  STORE_EDUCATION_REPORTS,
  STORE_EDUCATION_TASKS,
  STORE_ENERGY_LOGS,
  STORE_FINANCE_ENTRIES,
  STORE_FINANCE_SETTINGS,
  STORE_LEGACY_TASKS,
  STORE_MEAL_LOGS,
  STORE_META,
  STORE_NEWS_ITEMS,
  STORE_PROJECT_NOTES,
  STORE_PROJECTS,
  STORE_RADAR_ITEMS,
  STORE_RADAR_SAVED,
  STORE_SOCIAL_ACTIVITIES,
  STORE_SOCIAL_DRAFTS,
  STORE_STUDY_LOGS,
  STORE_STUDY_TIMERS,
  STORE_TIMELINE_BLOCKS,
  STORE_VITALS,
  STORE_WORKOUT_LOGS,
  STORE_WORK_SESSIONS,
} from '@/services/stores'

export const META_SEEDED_AT = 'seededAt'

export const STORE_DEFINITIONS: StoreDefinition[] = [
  {
    name: STORE_TIMELINE_BLOCKS,
    keyPath: 'id',
    indexes: [
      { name: 'by_date_key', keyPath: 'dateKey' },
      { name: 'by_start_time', keyPath: 'startTime' },
      { name: 'by_category', keyPath: 'category' },
      { name: 'by_status', keyPath: 'status' },
    ],
  },
  {
    name: STORE_WORK_SESSIONS,
    keyPath: 'id',
    indexes: [
      { name: 'by_date_key', keyPath: 'dateKey' },
      { name: 'by_kind_date', keyPath: ['kind', 'dateKey'] },
      { name: 'by_client', keyPath: 'clientName' },
    ],
  },
  {
    name: STORE_ENERGY_LOGS,
    keyPath: 'id',
    indexes: [
      { name: 'by_date_key', keyPath: 'dateKey' },
      { name: 'by_timestamp', keyPath: 'timestamp' },
    ],
  },
  { name: STORE_META, keyPath: 'key', indexes: [] },
  { name: STORE_DASHBOARD_DAYS, keyPath: 'dateKey', indexes: [] },
  { name: STORE_WORKOUT_LOGS, keyPath: 'id', indexes: [{ name: 'by_date_key', keyPath: 'dateKey' }] },
  { name: STORE_VITALS, keyPath: 'id', indexes: [{ name: 'by_date_key', keyPath: 'dateKey' }] },
  { name: STORE_BODY_WEIGHTS, keyPath: 'dateKey', indexes: [] },
  { name: STORE_DINNER_LOGS, keyPath: 'dateKey', indexes: [] },
  { name: STORE_STUDY_LOGS, keyPath: 'id', indexes: [{ name: 'by_date_key', keyPath: 'dateKey' }] },
  { name: STORE_RADAR_SAVED, keyPath: 'opportunityId', indexes: [] },
  { name: STORE_FINANCE_ENTRIES, keyPath: 'id', indexes: [{ name: 'by_month', keyPath: 'monthKey' }, { name: 'by_category', keyPath: 'category' }] },
  { name: STORE_SOCIAL_DRAFTS, keyPath: 'id', indexes: [{ name: 'by_updated_at', keyPath: 'updatedAt' }] },
  { name: STORE_FINANCE_SETTINGS, keyPath: 'id', indexes: [] },
  { name: STORE_NEWS_ITEMS, keyPath: 'id', indexes: [{ name: 'by_category', keyPath: 'category' }] },
  { name: STORE_MEAL_LOGS, keyPath: 'id', indexes: [{ name: 'by_date_key', keyPath: 'dateKey' }] },
  { name: STORE_LEGACY_TASKS, keyPath: 'id', indexes: [] },
  { name: STORE_RADAR_ITEMS, keyPath: 'id', indexes: [{ name: 'by_kind', keyPath: 'kind' }, { name: 'by_url', keyPath: 'url', options: { unique: true } }] },
  { name: STORE_STUDY_TIMERS, keyPath: 'id', indexes: [] },
  { name: STORE_EDUCATION_ITEMS, keyPath: 'id', indexes: [{ name: 'by_track', keyPath: 'track' }] },
  { name: STORE_PROJECTS, keyPath: 'id', indexes: [{ name: 'by_status', keyPath: 'status' }] },
  { name: STORE_PROJECT_NOTES, keyPath: 'id', indexes: [{ name: 'by_project', keyPath: 'projectId' }] },
  { name: STORE_SOCIAL_ACTIVITIES, keyPath: 'id', indexes: [{ name: 'by_status', keyPath: 'status' }] },
  { name: STORE_CARDIO_LOGS, keyPath: 'id', indexes: [{ name: 'by_date_key', keyPath: 'dateKey' }] },
  {
    name: STORE_EDUCATION_TASKS,
    keyPath: 'id',
    indexes: [
      { name: 'by_date_key', keyPath: 'dateKey' },
      { name: 'by_track', keyPath: 'track' },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_course', keyPath: 'courseId' },
    ],
  },
  {
    name: STORE_EDUCATION_REPORTS,
    keyPath: 'id',
    indexes: [
      { name: 'by_task', keyPath: 'taskId' },
      { name: 'by_date_key', keyPath: 'dateKey' },
      { name: 'by_track', keyPath: 'track' },
    ],
  },
]

export interface LegacyLifeTask {
  id: string
  title: string
  createdAt: number
  completedAt?: number
}

export interface OpportunityRecord {
  id: string
  kind: 'job' | 'freelance'
  platform: string
  title: string
  url: string
  description?: string
  budgetToman?: number
  skills: string[]
  bookmarked: boolean
  createdAt: string
  updatedAt: string
}

export const NEWS_CATEGORIES = ['ai', 'economy', 'politics', 'sports', 'technology', 'exam', 'macro'] as const
export type NewsCategory = (typeof NEWS_CATEGORIES)[number]
export type NewsOrigin = 'local' | 'online'
export interface NewsItem {
  id: string
  category: NewsCategory
  title: string
  summary: string
  source: string
  url?: string
  publishedAt?: string
  bookmarked: boolean
  archived: boolean
  /** Distinguishes manually recorded headlines from fetched online feed items. */
  origin: NewsOrigin
  createdAt: string
  updatedAt: string
}
export interface MealLog {
  id: string
  dateKey: string
  kind: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  description: string
  calories: number
  caloriesConfirmed?: boolean
  createdAt: string
  /** Portion text typed by the user (for example "۱ کف دست"). */
  quantity?: string
  /** Optional macro nutrients in grams. */
  protein?: number
  carbs?: number
  fat?: number
  /** `ai` marks a value that came from an assistant estimate the user approved. */
  source?: 'manual' | 'ai' | 'local'
}
export async function getNewsItems(options: { includeArchived?: boolean } = {}): Promise<NewsItem[]> {
  const db = await getDatabase()
  const rows = await getAllRecords<NewsItem>(db, STORE_NEWS_ITEMS)
  return rows
    .map((row) => ({ ...row, origin: row.origin === 'online' ? 'online' as const : 'local' as const }))
    .filter((row) => options.includeArchived || !row.archived)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export async function saveNewsItem(input: Omit<NewsItem,'id'|'createdAt'|'updatedAt'|'bookmarked'|'archived'|'origin'> & Partial<Pick<NewsItem,'id'|'bookmarked'|'archived'|'origin'>>): Promise<NewsItem> {
  const url = input.url?.trim() || undefined
  if (url) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new RangeError('news url must use http or https')
  }
  if (!NEWS_CATEGORIES.includes(input.category)) throw new RangeError('unknown news category')
  const publishedAt = input.publishedAt?.trim() || undefined
  if (publishedAt && !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) throw new RangeError('publishedAt must be a calendar date')
  const db = await getDatabase()
  const all = await getAllRecords<NewsItem>(db, STORE_NEWS_ITEMS)
  // Online feeds are de-duplicated by URL so refreshing keeps local bookmarks.
  const sameUrl = url ? all.find((row) => row.url === url) : undefined
  const existing = input.id
    ? await getRecord<NewsItem>(db, STORE_NEWS_ITEMS, input.id)
    : sameUrl
  const now = new Date().toISOString()
  const row: NewsItem = {
    ...input,
    url,
    publishedAt,
    id: existing?.id ?? input.id ?? createId('news'),
    bookmarked: input.bookmarked ?? existing?.bookmarked ?? false,
    archived: input.archived ?? existing?.archived ?? false,
    origin: input.origin ?? existing?.origin ?? 'local',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await putRecords(db, STORE_NEWS_ITEMS, [row])
  return row
}
export async function updateNewsItem(id:string,patch:Partial<Pick<NewsItem,'bookmarked'|'archived'>>):Promise<NewsItem>{const db=await getDatabase();const old=await getRecord<NewsItem>(db,STORE_NEWS_ITEMS,id);if(!old)throw new RangeError(`News item "${id}" does not exist`);const row={...old,...patch,origin:old.origin??'local',updatedAt:new Date().toISOString()};await putRecords(db,STORE_NEWS_ITEMS,[row]);return row}
export async function deleteNewsItem(id:string):Promise<void>{const db=await getDatabase();await deleteRecords(db,STORE_NEWS_ITEMS,[id])}
export async function getMealLogs(date:Date|string|number=new Date()):Promise<MealLog[]>{const db=await getDatabase();return getAllFromIndex<MealLog>(db,STORE_MEAL_LOGS,'by_date_key',toDateKey(date))}
export async function getMealLogsByRange(from:Date|string|number,to:Date|string|number):Promise<MealLog[]>{const range=resolveRange(from,to);if(!range)return [];const db=await getDatabase();return (await getAllFromIndex<MealLog>(db,STORE_MEAL_LOGS,'by_date_key',range)).sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||a.createdAt.localeCompare(b.createdAt))}
export async function saveMealLog(input:Omit<MealLog,'id'|'dateKey'|'createdAt'> & {date?:Date|string|number}):Promise<MealLog>{if(!input.description.trim())throw new RangeError('meal description is required');if(!Number.isSafeInteger(input.calories)||input.calories<0)throw new RangeError('calories must be a non-negative whole number');const db=await getDatabase();const when=input.date?toDate(input.date):new Date();const row={...input,id:createId('meal'),dateKey:toDateKey(when),createdAt:new Date().toISOString()};await putRecords(db,STORE_MEAL_LOGS,[row]);return row}
export async function updateMealLog(id:string, patch:Partial<Pick<MealLog,'description'|'calories'|'caloriesConfirmed'|'quantity'|'protein'|'carbs'|'fat'|'source'>>):Promise<MealLog>{const db=await getDatabase();const old=await getRecord<MealLog>(db,STORE_MEAL_LOGS,id);if(!old)throw new RangeError(`Meal log "${id}" does not exist`);const row={...old,...patch};if(row.description!==undefined&&!row.description.trim())throw new RangeError('meal description is required');if(!Number.isSafeInteger(row.calories)||row.calories<0)throw new RangeError('calories must be a non-negative whole number');await putRecords(db,STORE_MEAL_LOGS,[row]);return row}
export async function deleteMealLog(id:string):Promise<void>{const db=await getDatabase();await deleteRecords(db,STORE_MEAL_LOGS,[id])}

export interface FinanceEntry {
  id: string
  type: 'income' | 'expense' | 'saving'
  amount: number
  date: string
  monthKey: string
  title: string
  category: string
  note?: string
  createdAt: string
  updatedAt: string
}
export interface FinanceSettings { id: 'default'; savingsGoalBasisPoints: number }
export interface SocialDraft { id: string; platform: 'linkedin' | 'x'; achievementId: string; achievementTitle: string; text: string; createdAt: string; updatedAt: string }

function validateFinanceEntry(entry: Omit<FinanceEntry, 'id' | 'monthKey' | 'createdAt' | 'updatedAt'>): void {
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) throw new RangeError('amount must be a positive whole number of toman')
  if (!entry.title.trim() || !entry.category.trim()) throw new RangeError('title and category are required')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.date) throw new RangeError('date must use YYYY-MM-DD')
}
export async function getFinanceEntries(monthKey: string, category?: string): Promise<FinanceEntry[]> {
  const db=await getDatabase(); const entries=await getAllFromIndex<FinanceEntry>(db,STORE_FINANCE_ENTRIES,'by_month',monthKey)
  return entries.filter((entry)=>!category||entry.category===category).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt.localeCompare(a.updatedAt))
}
export async function saveFinanceEntry(input: Omit<FinanceEntry,'id'|'monthKey'|'createdAt'|'updatedAt'> & {id?:string}): Promise<FinanceEntry> {
  validateFinanceEntry(input); const db=await getDatabase(); const existing=input.id?await getRecord<FinanceEntry>(db,STORE_FINANCE_ENTRIES,input.id):undefined; const now=new Date().toISOString()
  const record:FinanceEntry={...input,id:existing?.id??input.id??createId('finance'),monthKey:input.date.slice(0,7),createdAt:existing?.createdAt??now,updatedAt:now}
  await putRecords(db,STORE_FINANCE_ENTRIES,[record]); return record
}
export async function deleteFinanceEntry(id:string):Promise<void>{const db=await getDatabase();await deleteRecords(db,STORE_FINANCE_ENTRIES,[id])}
export async function getFinanceSettings():Promise<FinanceSettings>{const db=await getDatabase();return (await getRecord<FinanceSettings>(db,STORE_FINANCE_SETTINGS,'default'))??{id:'default',savingsGoalBasisPoints:5000}}
export async function saveFinanceSettings(savingsGoalBasisPoints:number):Promise<FinanceSettings>{if(!Number.isInteger(savingsGoalBasisPoints)||savingsGoalBasisPoints<0||savingsGoalBasisPoints>10000)throw new RangeError('savings goal must be between 0 and 100 percent');const record:FinanceSettings={id:'default',savingsGoalBasisPoints};const db=await getDatabase();await putRecords(db,STORE_FINANCE_SETTINGS,[record]);return record}
export async function getSocialDrafts():Promise<SocialDraft[]>{const db=await getDatabase();return (await getAllRecords<SocialDraft>(db,STORE_SOCIAL_DRAFTS)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
export async function saveSocialDraft(input:Omit<SocialDraft,'id'|'createdAt'|'updatedAt'> & {id?:string}):Promise<SocialDraft>{if(!input.text.trim())throw new RangeError('draft text must not be empty');const db=await getDatabase();const existing=input.id?await getRecord<SocialDraft>(db,STORE_SOCIAL_DRAFTS,input.id):undefined;const now=new Date().toISOString();const record:SocialDraft={...input,id:existing?.id??input.id??createId('draft'),createdAt:existing?.createdAt??now,updatedAt:now};await putRecords(db,STORE_SOCIAL_DRAFTS,[record]);return record}
export async function deleteSocialDraft(id:string):Promise<void>{const db=await getDatabase();await deleteRecords(db,STORE_SOCIAL_DRAFTS,[id])}

export interface StudyLog {
  id: string
  dateKey: string
  category: 'ml' | 'exam' | 'coding'
  minutes: number
  note: string
  createdAt: string
  /** Learning track this session belongs to (masters / university / course). */
  track?: LearningTrack
  /** Learning item (subject, topic, course) this session belongs to. */
  itemId?: string
}
/** Independent learning tracks: master's, university courses and online courses. */
export const LEARNING_TRACKS = ['masters', 'university', 'course'] as const
export type LearningTrack = (typeof LEARNING_TRACKS)[number]
export function isLearningTrack(value: unknown): value is LearningTrack {
  return LEARNING_TRACKS.some((track) => track === value)
}
export interface SavedOpportunity { opportunityId: string; savedAt: string }
export async function getStudyLogs(date: Date | string | number = new Date()): Promise<StudyLog[]> { const db=await getDatabase(); return getAllFromIndex<StudyLog>(db,STORE_STUDY_LOGS,'by_date_key',toDateKey(date)) }
export async function getStudyLogsByRange(from: Date | string | number, to: Date | string | number): Promise<StudyLog[]> { const range=resolveRange(from,to); if(!range)return []; const db=await getDatabase(); return getAllFromIndex<StudyLog>(db,STORE_STUDY_LOGS,'by_date_key',range) }
export async function saveStudyLog(input: Omit<StudyLog,'id'|'dateKey'|'createdAt'> & { track?: LearningTrack; itemId?: string }): Promise<StudyLog> {
  if(!Number.isInteger(input.minutes)||input.minutes<1)throw new RangeError('study minutes must be a positive whole number')
  if (input.track !== undefined && !isLearningTrack(input.track)) throw new RangeError('unknown learning track')
  const db=await getDatabase(); const record={...input,note:input.note.trim(),id:createId('study'),dateKey:toDateKey(new Date()),createdAt:new Date().toISOString()};await putRecords(db,STORE_STUDY_LOGS,[record]);return record
}
export async function deleteStudyLog(id: string): Promise<void> { const db=await getDatabase(); await deleteRecords(db,STORE_STUDY_LOGS,[id]) }

export interface StudyTimerRecord {
  id: 'active'
  category: StudyLog['category']
  note: string
  accumulatedSeconds: number
  startedAt?: string
  updatedAt: string
  /** Track of the running session (masters / university / course). */
  track?: LearningTrack
  /** Learning item the running session belongs to. */
  itemId?: string
}

/** Persistent study stopwatch state; survives reloads and browser restarts. */
export async function getStudyTimer(): Promise<StudyTimerRecord | undefined> {
  const db=await getDatabase()
  const record=await getRecord<StudyTimerRecord>(db,STORE_STUDY_TIMERS,'active')
  if(!record)return undefined
  return { ...record, accumulatedSeconds: Math.max(0, Math.floor(record.accumulatedSeconds||0)) }
}
export async function saveStudyTimerMeta(patch: Partial<Pick<StudyTimerRecord,'category'|'note'|'track'|'itemId'>>): Promise<StudyTimerRecord> {
  const current=await getStudyTimer()
  const record: StudyTimerRecord={ id:'active', category:patch.category??current?.category??'ml', note:patch.note??current?.note??'', accumulatedSeconds:current?.accumulatedSeconds??0, ...(current?.startedAt?{startedAt:current.startedAt}:{}), ...(patch.track!==undefined?{track:patch.track}:current?.track?{track:current.track}:{}), ...(patch.itemId!==undefined?{itemId:patch.itemId}:current?.itemId?{itemId:current.itemId}:{}), updatedAt:new Date().toISOString() }
  const db=await getDatabase(); await putRecords(db,STORE_STUDY_TIMERS,[record]); return record
}
export async function startStudyTimer(category: StudyLog['category']='ml', track?: LearningTrack, itemId?: string): Promise<StudyTimerRecord> {
  const current=await getStudyTimer()
  const record: StudyTimerRecord={ id:'active', category, note:current?.note??'', accumulatedSeconds:current?.accumulatedSeconds??0, startedAt:current?.startedAt??new Date().toISOString(), ...(track?{track}:current?.track?{track:current.track}:{}), ...(itemId?{itemId}:current?.itemId?{itemId:current.itemId}:{}), updatedAt:new Date().toISOString() }
  const db=await getDatabase(); await putRecords(db,STORE_STUDY_TIMERS,[record]); return record
}
export async function pauseStudyTimer(): Promise<StudyTimerRecord | undefined> {
  const current=await getStudyTimer()
  if(!current)return undefined
  const live=current.startedAt ? Math.max(0,Math.floor((Date.now()-Date.parse(current.startedAt))/1000)) : 0
  const record: StudyTimerRecord={ ...current, accumulatedSeconds:current.accumulatedSeconds+live, startedAt:undefined, updatedAt:new Date().toISOString() }
  const db=await getDatabase(); await putRecords(db,STORE_STUDY_TIMERS,[record]); return record
}
export async function clearStudyTimer(): Promise<void> { const db=await getDatabase(); await deleteRecords(db,STORE_STUDY_TIMERS,['active']) }
export async function finishStudyTimer(input: Pick<StudyLog,'note'|'category'> & { track?: LearningTrack; itemId?: string }): Promise<StudyLog | null> {
  const paused=await pauseStudyTimer()
  if(!paused || paused.accumulatedSeconds<1){ await clearStudyTimer(); return null }
  const log=await saveStudyLog({ category:input.category, minutes:Math.max(1,Math.floor(paused.accumulatedSeconds/60)), note:input.note, ...(input.track?{track:input.track}:paused.track?{track:paused.track}:{}), ...(input.itemId?{itemId:input.itemId}:paused.itemId?{itemId:paused.itemId}:{}) })
  await clearStudyTimer()
  return log
}
export async function getSavedOpportunities(): Promise<SavedOpportunity[]> { const db=await getDatabase(); return getAllRecords<SavedOpportunity>(db,STORE_RADAR_SAVED) }
export async function setOpportunitySaved(opportunityId:string,saved:boolean):Promise<void> { const db=await getDatabase(); if(saved) await putRecords(db,STORE_RADAR_SAVED,[{opportunityId,savedAt:new Date().toISOString()}]); else await deleteRecords(db,STORE_RADAR_SAVED,[opportunityId]) }

export interface RadarProfile {
  /** Skills copied from the user's own resume; used only for local match estimates. */
  skills: string[]
  headline: string
  summary: string
}

const RADAR_PROFILE_KEY = 'radarProfile'

export async function getRadarProfile(): Promise<RadarProfile> {
  const db=await getDatabase()
  const record=await getRecord<MetaRecord>(db,STORE_META,RADAR_PROFILE_KEY)
  if(!record)return { skills: [], headline: '', summary: '' }
  try {
    const parsed=JSON.parse(record.value) as Partial<RadarProfile>
    return { skills:Array.isArray(parsed.skills)?parsed.skills.filter((skill):skill is string=>typeof skill==='string'):[], headline:typeof parsed.headline==='string'?parsed.headline:'', summary:typeof parsed.summary==='string'?parsed.summary:'' }
  } catch { return { skills: [], headline: '', summary: '' } }
}

export async function saveRadarProfile(input: RadarProfile): Promise<RadarProfile> {
  const profile: RadarProfile={ skills:[...new Set(input.skills.map((skill)=>skill.trim()).filter(Boolean))], headline:input.headline.trim(), summary:input.summary.trim() }
  const db=await getDatabase()
  await putRecords<MetaRecord>(db,STORE_META,[{ key:RADAR_PROFILE_KEY, value:JSON.stringify(profile) }])
  return profile
}

export async function getOpportunityRecords(kind?: OpportunityRecord['kind']): Promise<OpportunityRecord[]> {
  const db = await getDatabase()
  const rows = kind ? await getAllFromIndex<OpportunityRecord>(db, STORE_RADAR_ITEMS, 'by_kind', kind) : await getAllRecords<OpportunityRecord>(db, STORE_RADAR_ITEMS)
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function saveOpportunityRecord(input: Omit<OpportunityRecord, 'id' | 'bookmarked' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<OpportunityRecord> {
  if (!input.title.trim() || !input.platform.trim()) throw new RangeError('opportunity title and source are required')
  let url: URL
  try { url = new URL(input.url) } catch { throw new RangeError('opportunity URL is invalid') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new RangeError('opportunity URL must use HTTP or HTTPS')
  if (input.budgetToman !== undefined && (!Number.isSafeInteger(input.budgetToman) || input.budgetToman <= 0)) throw new RangeError('budget must be a positive whole toman amount')
  const db = await getDatabase()
  const old = input.id ? await getRecord<OpportunityRecord>(db, STORE_RADAR_ITEMS, input.id) : undefined
  const row: OpportunityRecord = {
    ...input,
    url: url.toString(),
    id: old?.id ?? input.id ?? createId('opportunity'),
    skills: [...new Set(input.skills.map((skill) => skill.trim()).filter(Boolean))],
    bookmarked: old?.bookmarked ?? false,
    createdAt: old?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await putRecords(db, STORE_RADAR_ITEMS, [row])
  return row
}

export async function updateOpportunityRecord(id: string, patch: Partial<Pick<OpportunityRecord, 'bookmarked'>>): Promise<OpportunityRecord> {
  const db = await getDatabase()
  const old = await getRecord<OpportunityRecord>(db, STORE_RADAR_ITEMS, id)
  if (!old) throw new RangeError(`Opportunity "${id}" does not exist`)
  const row = { ...old, ...patch, updatedAt: new Date().toISOString() }
  await putRecords(db, STORE_RADAR_ITEMS, [row])
  return row
}

export async function deleteOpportunityRecord(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_RADAR_ITEMS, [id])
  await deleteRecords(db, STORE_RADAR_SAVED, [id])
}

export interface WorkoutSet { id: string; dateKey: string; exercise: string; set: number; weightKg: number; reps: number; rir: number; createdAt: string }
export interface VitalRecord { id: string; dateKey: string; period: 'morning' | 'evening'; systolic: number; diastolic: number; pulse: number; measuredAt: string }
export interface BodyWeightRecord { dateKey: string; weightKg: number; updatedAt: string }
export interface DinnerRecord { dateKey: string; description: string; calories: number; caloriesConfirmed?: boolean; updatedAt: string }

export async function getWorkoutLogs(date: Date | string | number = new Date()): Promise<WorkoutSet[]> { const db = await getDatabase(); return getAllFromIndex<WorkoutSet>(db, STORE_WORKOUT_LOGS, 'by_date_key', toDateKey(date)) }
export async function getWorkoutLogsByRange(from: Date | string | number, to: Date | string | number): Promise<WorkoutSet[]> { const range=resolveRange(from,to); if(!range)return []; const db=await getDatabase(); return (await getAllFromIndex<WorkoutSet>(db,STORE_WORKOUT_LOGS,'by_date_key',range)).sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||a.exercise.localeCompare(b.exercise)||a.set-b.set) }
export async function saveWorkoutSet(input: Omit<WorkoutSet, 'id' | 'dateKey' | 'createdAt'> & { date?: Date | string | number }): Promise<WorkoutSet> {
  if(!input.exercise.trim())throw new RangeError('exercise is required')
  if(!Number.isInteger(input.set)||input.set<1)throw new RangeError('set must be a positive whole number')
  if(!Number.isFinite(input.weightKg)||input.weightKg<0)throw new RangeError('weight must be non-negative')
  if(!Number.isInteger(input.reps)||input.reps<1)throw new RangeError('reps must be a positive whole number')
  if(!Number.isInteger(input.rir)||input.rir<0||input.rir>10)throw new RangeError('RIR must be between 0 and 10')
  const db = await getDatabase(); const record = { ...input, exercise:input.exercise.trim(), id: createId('set'), dateKey: toDateKey(input.date ?? new Date()), createdAt: new Date().toISOString() }; await putRecords(db, STORE_WORKOUT_LOGS, [record]); return record
}
export async function deleteWorkoutSet(id: string): Promise<void> { const db = await getDatabase(); await deleteRecords(db, STORE_WORKOUT_LOGS, [id]) }
export async function getVitals(date: Date | string | number = new Date()): Promise<VitalRecord[]> { const db = await getDatabase(); return getAllFromIndex<VitalRecord>(db, STORE_VITALS, 'by_date_key', toDateKey(date)) }
export async function getVitalsByRange(from: Date | string | number, to: Date | string | number): Promise<VitalRecord[]> { const range=resolveRange(from,to); if(!range)return []; const db=await getDatabase(); return (await getAllFromIndex<VitalRecord>(db,STORE_VITALS,'by_date_key',range)).sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||a.measuredAt.localeCompare(b.measuredAt)) }
export async function saveVital(input: Omit<VitalRecord, 'id' | 'dateKey' | 'measuredAt'>): Promise<VitalRecord> {
  if (!Number.isInteger(input.systolic) || !Number.isInteger(input.diastolic) || input.systolic < 50 || input.systolic > 300 || input.diastolic < 30 || input.diastolic > 200 || !Number.isInteger(input.pulse) || input.pulse < 0 || input.pulse > 250) throw new RangeError('blood pressure or pulse value is outside the accepted range')
  const db = await getDatabase()
  const now = new Date()
  const record = { ...input, id: createId('vital'), dateKey: toDateKey(now), measuredAt: now.toISOString() }
  await putRecords(db, STORE_VITALS, [record])
  return record
}
export async function getBodyWeight(date: Date | string | number = new Date()): Promise<BodyWeightRecord | undefined> { const db = await getDatabase(); return getRecord<BodyWeightRecord>(db, STORE_BODY_WEIGHTS, toDateKey(date)) }
export async function getBodyWeightsByRange(from: Date | string | number, to: Date | string | number): Promise<BodyWeightRecord[]> { const range=resolveRange(from,to); if(!range)return []; const db=await getDatabase(); return (await getAllRecords<BodyWeightRecord>(db,STORE_BODY_WEIGHTS)).filter((row)=>row.dateKey>=toDateKey(from)&&row.dateKey<=toDateKey(to)).sort((a,b)=>a.dateKey.localeCompare(b.dateKey)) }
export async function saveBodyWeight(weightKg: number): Promise<BodyWeightRecord> { if(!Number.isFinite(weightKg)||weightKg<20||weightKg>400)throw new RangeError('weight is outside the accepted range'); const db = await getDatabase(); const record = { dateKey: toDateKey(new Date()), weightKg, updatedAt: new Date().toISOString() }; await putRecords(db, STORE_BODY_WEIGHTS, [record]); return record }
export async function getDinner(date: Date | string | number = new Date()): Promise<DinnerRecord | undefined> { const db = await getDatabase(); return getRecord<DinnerRecord>(db, STORE_DINNER_LOGS, toDateKey(date)) }
export async function saveDinner(description: string, calories: number, caloriesConfirmed = false): Promise<DinnerRecord> { if(!description.trim())throw new RangeError('dinner description is required');if(!Number.isSafeInteger(calories)||calories<0)throw new RangeError('calories must be a non-negative whole number');const db = await getDatabase(); const record = { dateKey: toDateKey(new Date()), description: description.trim(), calories, caloriesConfirmed, updatedAt: new Date().toISOString() }; await putRecords(db, STORE_DINNER_LOGS, [record]); return record }

export interface DashboardDayRecord {
  dateKey: string
  sleepTime?: string
  wakeTime: string
  breakfast: string
  breakfastCalories?: number
  breakfastCaloriesIsConfirmed?: boolean
  bookName?: string
  readingMinutes?: number
  lunchDescription?: string
  lunchCalories?: number
  lunchCaloriesIsConfirmed?: boolean
  bagItems: { id: string; label: string; checked: boolean }[]
  commuteTime: string
  note: string
  updatedAt: string
}

export async function getDashboardDay(date: Date | string | number = new Date()): Promise<DashboardDayRecord | undefined> {
  const database = await getDatabase()
  return getRecord<DashboardDayRecord>(database, STORE_DASHBOARD_DAYS, toDateKey(date))
}

export async function saveDashboardDay(record: DashboardDayRecord): Promise<DashboardDayRecord> {
  const database = await getDatabase()
  const saved = { ...record, updatedAt: new Date().toISOString() }
  await putRecords(database, STORE_DASHBOARD_DAYS, [saved])
  return saved
}

/** Writes only the quick note inside one transaction so stale UI state can never overwrite the day's routine fields. */
export async function saveDashboardNote(date: Date | string | number, note: string): Promise<DashboardDayRecord> {
  const dateKey = toDateKey(date)
  const database = await getDatabase()
  const tx = database.transaction(STORE_DASHBOARD_DAYS, 'readwrite')
  const complete = awaitTransaction(tx)
  try {
    const store = tx.objectStore(STORE_DASHBOARD_DAYS)
    const existing = await promisifyRequest<DashboardDayRecord | undefined>(store.get(dateKey))
    const saved: DashboardDayRecord = {
      ...(existing ?? { dateKey, wakeTime: '', breakfast: '', bagItems: [], commuteTime: '', note: '', updatedAt: '' }),
      dateKey,
      note,
      updatedAt: new Date().toISOString(),
    }
    store.put(saved)
    await complete
    return saved
  } catch (error) {
    try { tx.abort() } catch { /* transaction already closed */ }
    await complete.catch(() => undefined)
    throw error
  }
}

/** The most recent non-empty quick note saved on a day before `date`. */
export async function getPreviousDashboardNote(
  date: Date | string | number = new Date()
): Promise<{ dateKey: string; note: string } | undefined> {
  const database = await getDatabase()
  const earlier = await getAllRecords<DashboardDayRecord>(
    database,
    STORE_DASHBOARD_DAYS,
    IDBKeyRange.upperBound(toDateKey(date), true)
  )
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const { dateKey, note } = earlier[index]
    if (note?.trim()) return { dateKey, note }
  }
  return undefined
}

interface MetaRecord {
  key: string
  value: string
}

export interface SeedingResult {
  seeded: boolean
  counts: Record<string, number>
}

let databasePromise: Promise<IDBDatabase> | null = null
let initializationPromise: Promise<void> | null = null

/** Lazily opens (and upgrades) the shared IndexedDB connection. */
export function getDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase(
      DB_NAME,
      DB_VERSION,
      STORE_DEFINITIONS
    ).then(async (database) => {
      await migrateLegacyLifeTasks(database)
      await migrateLegacyMeals(database)
      return database
    }).catch((error: unknown) => {
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

/**
 * Copies the prototype's task rows without inferring dates or durations.
 * The source database is intentionally kept intact so an interrupted or
 * repeated migration cannot lose user data.
 */
async function migrateLegacyLifeTasks(database: IDBDatabase): Promise<void> {
  if (!isIndexedDbAvailable()) return
  const legacyDatabase = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open('mehr-life-time')
    let createdForCheck = false
    request.onupgradeneeded = (event) => {
      createdForCheck = event.oldVersion === 0
    }
    request.onsuccess = () => {
      const source = request.result
      if (!source.objectStoreNames.contains('tasks')) {
        source.close()
        if (createdForCheck) {
          void deleteDatabase('mehr-life-time').then(() => resolve(null), reject)
        } else resolve(null)
        return
      }
      resolve(source)
    }
    request.onerror = () => reject(request.error)
  })
  if (!legacyDatabase) return
  try {
    const records = await getAllRecords<LegacyLifeTask>(legacyDatabase, 'tasks')
    const valid = records.filter((row) =>
      typeof row.id === 'string' && typeof row.title === 'string' &&
      typeof row.createdAt === 'number'
    )
    await putRecords(database, STORE_LEGACY_TASKS, valid)
  } finally {
    legacyDatabase.close()
  }
}

export async function getLegacyTasks(): Promise<LegacyLifeTask[]> {
  const database = await getDatabase()
  return (await getAllRecords<LegacyLifeTask>(database, STORE_LEGACY_TASKS))
    .sort((a, b) => b.createdAt - a.createdAt)
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`)
  }
}

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new RangeError(`${label} must not be empty`)
  }
  return trimmed
}

function resolveRange(
  from: Date | string | number,
  to: Date | string | number
): IDBKeyRange | null {
  const fromKey = toDateKey(from)
  const toKey = toDateKey(to)
  return fromKey <= toKey ? IDBKeyRange.bound(fromKey, toKey) : null
}

function sortByStartTime(blocks: TimelineBlockRecord[]): TimelineBlockRecord[] {
  return [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime))
}

// ---------------------------------------------------------------------------
// Timeline blocks
// ---------------------------------------------------------------------------

export async function getTimelineBlocksByDate(
  date: Date | string | number
): Promise<TimelineBlockRecord[]> {
  const database = await getDatabase()
  const records = await getAllFromIndex<TimelineBlockRecord>(
    database,
    STORE_TIMELINE_BLOCKS,
    'by_date_key',
    toDateKey(date)
  )
  return sortByStartTime(records)
}

export async function getTimelineBlocksByRange(
  from: Date | string | number,
  to: Date | string | number
): Promise<TimelineBlockRecord[]> {
  const range = resolveRange(from, to)
  if (!range) return []

  const database = await getDatabase()
  const records = await getAllFromIndex<TimelineBlockRecord>(
    database,
    STORE_TIMELINE_BLOCKS,
    'by_date_key',
    range
  )
  return sortByStartTime(records)
}

export async function getTimelineBlock(
  id: string
): Promise<TimelineBlockRecord | undefined> {
  const database = await getDatabase()
  return getRecord<TimelineBlockRecord>(database, STORE_TIMELINE_BLOCKS, id)
}

function buildBlockRecord(
  input: TimelineBlockPatch,
  base?: TimelineBlockRecord
): TimelineBlockRecord {
  const now = toIsoString(new Date())
  const startTime = input.startTime ?? base?.startTime
  if (startTime === undefined) {
    throw new RangeError('startTime is required to store a timeline block')
  }

  const startIso = toIsoString(startTime)
  const endSource = input.endTime ?? base?.endTime ?? startTime
  const endIso = toIsoString(endSource)

  const startDate = toDate(startIso)
  const endDate = toDate(endIso)
  const derivedMinutes = Math.round(
    (endDate.getTime() - startDate.getTime()) / 60_000
  )
  const durationMinutes =
    input.durationMinutes ??
    base?.durationMinutes ??
    Math.max(derivedMinutes, 0)
  assertFinite(durationMinutes, 'durationMinutes')

  const energy = input.energyLevelRequired ?? base?.energyLevelRequired
  if (!isEnergyScore(energy)) {
    throw new RangeError('energyLevelRequired must be between 1 and 5')
  }

  const priority = input.priority ?? base?.priority ?? 'medium'
  if (!isTaskPriority(priority)) {
    throw new RangeError('priority must be low, medium, high, or urgent')
  }

  return {
    id: input.id ?? base?.id ?? createId('block'),
    title: assertNonEmpty(input.title ?? base?.title ?? '', 'title'),
    category: input.category ?? base?.category ?? 'buffer',
    startTime: startIso,
    endTime: endIso,
    durationMinutes,
    energyLevelRequired: energy,
    status: input.status ?? base?.status ?? 'planned',
    isConflictFree: input.isConflictFree ?? base?.isConflictFree ?? true,
    notes: input.notes ?? base?.notes,
    elapsedSeconds: input.elapsedSeconds ?? base?.elapsedSeconds ?? 0,
    timerStartedAt:
      input.status === 'paused' || input.status === 'completed' || input.status === 'rolled_over'
        ? undefined
        : input.timerStartedAt ?? base?.timerStartedAt,
    rolledOverFrom: input.rolledOverFrom ?? base?.rolledOverFrom,
    isCompanyWork: input.isCompanyWork ?? base?.isCompanyWork ?? true,
    priority,
    projectId: input.projectId ?? base?.projectId,
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
    dateKey: toDateKey(startIso),
  }
}

/** Local-first write: `put` only, no backend round trip. */
export async function saveTimelineBlock(
  input: TimelineBlockInput
): Promise<TimelineBlockRecord> {
  const database = await getDatabase()
  const base = input.id
    ? await getRecord<TimelineBlockRecord>(
        database,
        STORE_TIMELINE_BLOCKS,
        input.id
      )
    : undefined

  const record = buildBlockRecord(input, base)
  await putRecords(database, STORE_TIMELINE_BLOCKS, [record])
  return record
}

export async function updateTimelineBlock(
  id: string,
  patch: TimelineBlockPatch
): Promise<TimelineBlockRecord> {
  const database = await getDatabase()
  const base = await getRecord<TimelineBlockRecord>(
    database,
    STORE_TIMELINE_BLOCKS,
    id
  )
  if (!base) {
    throw new RangeError(`Timeline block "${id}" does not exist`)
  }

  const record = buildBlockRecord({ ...patch, id }, base)
  await putRecords(database, STORE_TIMELINE_BLOCKS, [record])
  return record
}

export async function updateTimelineBlockStatus(
  id: string,
  status: TimelineBlock['status']
): Promise<TimelineBlockRecord> {
  return updateTimelineBlock(id, { status })
}

export async function saveTimelineBlocks(
  inputs: TimelineBlockInput[]
): Promise<TimelineBlockRecord[]> {
  if (inputs.length === 0) return []
  const database = await getDatabase()
  const records = inputs.map((input) => buildBlockRecord(input))
  await putRecords(database, STORE_TIMELINE_BLOCKS, records)
  return records
}

export async function deleteTimelineBlock(id: string): Promise<void> {
  const database = await getDatabase()
  await deleteRecords(database, STORE_TIMELINE_BLOCKS, [id])
}

export async function getWorkTasksByDate(date: Date | string | number): Promise<TimelineBlockRecord[]> {
  return (await getTimelineBlocksByDate(date)).filter((block) => block.category === 'work' || block.category === 'freelance')
}
export async function getAllWorkTasks(): Promise<TimelineBlockRecord[]> {
  const db=await getDatabase(); return (await getAllRecords<TimelineBlockRecord>(db,STORE_TIMELINE_BLOCKS)).filter((block)=>block.category==='work'||block.category==='freelance').sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||a.startTime.localeCompare(b.startTime))
}

export interface WorkTaskInput {
  title: string
  startTime: Date | string | number
  durationMinutes: number
  isCompanyWork: boolean
  notes?: string
  priority?: TaskPriority
  /** Optional link to a personal project. */
  projectId?: string
}

export type WorkTaskPatch = Partial<Omit<WorkTaskInput, 'startTime'>> & {
  startTime?: Date | string | number
}

function validateWorkTaskWindow(start: Date, durationMinutes: number): Date {
  if (!Number.isFinite(start.getTime())) throw new RangeError('startTime is invalid')
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) throw new RangeError('durationMinutes must be between 1 and 720')
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  if (toDateKey(start) !== toDateKey(end)) throw new RangeError('work tasks must end on the same day')
  if (intersectsLunch(start, end)) throw new RangeError('work tasks cannot overlap the protected 13:00–14:00 lunch slot')
  return end
}

/** Creates a task only when its entire scheduled interval is clear and outside the protected lunch hour. */
export async function saveWorkTask(input: WorkTaskInput): Promise<TimelineBlockRecord> {
  const start = toDate(input.startTime)
  const end = validateWorkTaskWindow(start, input.durationMinutes)
  const record = buildBlockRecord({ title: input.title, category: input.isCompanyWork ? 'work' : 'freelance', startTime: start, endTime: end, durationMinutes: input.durationMinutes, energyLevelRequired: 3, status: 'planned', isCompanyWork: input.isCompanyWork, ...(input.notes !== undefined ? { notes: input.notes } : {}), priority: input.priority ?? 'medium', ...(input.projectId !== undefined ? { projectId: input.projectId } : {}) })
  const db = await getDatabase()
  const tx = db.transaction(STORE_TIMELINE_BLOCKS, 'readwrite')
  const complete = awaitTransaction(tx)
  try {
    const scheduled = await promisifyRequest<TimelineBlockRecord[]>(tx.objectStore(STORE_TIMELINE_BLOCKS).index('by_date_key').getAll(record.dateKey))
    if (findWorkTaskConflict(record, scheduled)) throw new RangeError('work task overlaps another scheduled work task')
    tx.objectStore(STORE_TIMELINE_BLOCKS).put(record)
    await complete
    return record
  } catch (error) {
    try { tx.abort() } catch { /* transaction already closed */ }
    await complete.catch(() => undefined)
    throw error
  }
}

/** Edits title, priority, notes, company flag, duration, or schedule without resetting elapsed time. */
export async function updateWorkTask(id: string, patch: WorkTaskPatch): Promise<TimelineBlockRecord> {
  const db = await getDatabase()
  const base = await getRecord<TimelineBlockRecord>(db, STORE_TIMELINE_BLOCKS, id)
  if (!base) throw new RangeError(`Work task "${id}" does not exist`)
  if (base.status === 'completed' || base.status === 'skipped') throw new RangeError('completed tasks cannot be edited')
  const durationMinutes = patch.durationMinutes ?? base.durationMinutes
  const start = toDate(patch.startTime ?? base.startTime)
  const end = validateWorkTaskWindow(start, durationMinutes)
  const record = buildBlockRecord({
    id,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.isCompanyWork !== undefined ? { isCompanyWork: patch.isCompanyWork, category: patch.isCompanyWork ? 'work' : 'freelance' } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
    startTime: start,
    endTime: end,
    durationMinutes,
  }, base)
  const tx = db.transaction(STORE_TIMELINE_BLOCKS, 'readwrite')
  const complete = awaitTransaction(tx)
  try {
    const scheduled = await promisifyRequest<TimelineBlockRecord[]>(tx.objectStore(STORE_TIMELINE_BLOCKS).index('by_date_key').getAll(record.dateKey))
    if (findWorkTaskConflict(record, scheduled)) throw new RangeError('work task overlaps another scheduled work task')
    tx.objectStore(STORE_TIMELINE_BLOCKS).put(record)
    await complete
    return record
  } catch (error) {
    try { tx.abort() } catch { /* transaction already closed */ }
    await complete.catch(() => undefined)
    throw error
  }
}

/**
 * Deletes a task while preserving every second already logged for it: linked
 * sessions are unlinked instead of deleted, so work reports keep the time.
 */
export async function deleteWorkTask(id: string): Promise<void> {
  const db = await getDatabase()
  const tx = db.transaction([STORE_TIMELINE_BLOCKS, STORE_WORK_SESSIONS], 'readwrite')
  const complete = awaitTransaction(tx)
  try {
    tx.objectStore(STORE_TIMELINE_BLOCKS).delete(id)
    const sessions = await promisifyRequest<WorkSessionRecord[]>(tx.objectStore(STORE_WORK_SESSIONS).getAll())
    for (const session of sessions) {
      if (session.timelineBlockId !== id) continue
      const { timelineBlockId: _removed, ...rest } = session
      tx.objectStore(STORE_WORK_SESSIONS).put({ ...rest, updatedAt: toIsoString(new Date()) })
    }
    await complete
  } catch (error) {
    try { tx.abort() } catch { /* transaction already closed */ }
    await complete.catch(() => undefined)
    throw error
  }
}

/**
 * Elastic scheduling: moves unfinished work that is overdue (or left on an
 * earlier day) into the nearest free future slot. The lunch hour is always
 * excluded and a single move keeps all accumulated timer seconds intact.
 */
export async function autoRolloverStaleWorkTasks(
  reference: Date | string | number = new Date()
): Promise<TimelineBlockRecord[]> {
  const now = toDate(reference)
  if (!Number.isFinite(now.getTime())) return []
  const db = await getDatabase()
  const all = await getAllRecords<TimelineBlockRecord>(db, STORE_TIMELINE_BLOCKS)
  const todayKey = toDateKey(now)
  const stale = all.filter((block) =>
    (block.category === 'work' || block.category === 'freelance') &&
    ['planned', 'paused', 'rolled_over'].includes(block.status) &&
    (block.dateKey < todayKey || Date.parse(block.endTime) <= now.getTime())
  )
  if (stale.length === 0) return []

  const staleIds = new Set(stale.map((block) => block.id))
  const busy = all.filter((block) =>
    !staleIds.has(block.id) &&
    ['planned', 'in_progress', 'paused', 'rolled_over'].includes(block.status)
  )
  const moved: TimelineBlockRecord[] = []
  const startSearch = new Date(now.getTime() + 5 * 60_000)

  for (const base of stale.sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const durationMinutes = Math.min(720, Math.max(1, Math.round(base.durationMinutes)))
    const target = findNextFreeSlot(startSearch, durationMinutes, busy)
    if (!target) continue
    const settledSeconds = settleTimelineBlockSeconds(base, now.getTime())
    const record = buildBlockRecord({
      id: base.id,
      startTime: target,
      endTime: new Date(target.getTime() + durationMinutes * 60_000),
      durationMinutes,
      status: 'rolled_over',
      elapsedSeconds: settledSeconds,
      timerStartedAt: undefined,
      rolledOverFrom: base.dateKey,
    }, base)
    await putRecords(db, STORE_TIMELINE_BLOCKS, [record])
    busy.push(record)
    moved.push(record)
  }
  return moved
}

let startupRolloverPromise: Promise<TimelineBlockRecord[]> | null = null

/** Runs the overdue-task rollover once per app session; task readers await it so they never show pre-move data. */
export function runStartupRollover(): Promise<TimelineBlockRecord[]> {
  if (!startupRolloverPromise) {
    startupRolloverPromise = autoRolloverStaleWorkTasks().catch((error: unknown) => {
      startupRolloverPromise = null
      throw error
    })
  }
  return startupRolloverPromise
}

async function recordTimerInterval(store: IDBObjectStore, block: TimelineBlockRecord, endedAt: Date): Promise<void> {
  if (!block.timerStartedAt) return
  const startedAt = new Date(block.timerStartedAt)
  const seconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000))
  if (!seconds) return
  store.put(buildWorkSessionRecord({
    timelineBlockId: block.id,
    clientName: block.title,
    taskType: 'other',
    durationHours: seconds / 3600,
    date: startedAt,
    isCompanyWork: block.isCompanyWork !== false,
    notes: block.notes,
  }))
}

async function mutateWorkTimer(id: string, action: 'start' | 'pause' | 'stop' | 'complete'): Promise<TimelineBlockRecord> {
  const db = await getDatabase()
  const tx = db.transaction([STORE_TIMELINE_BLOCKS, STORE_WORK_SESSIONS], 'readwrite')
  const complete = awaitTransaction(tx)
  try {
    const store = tx.objectStore(STORE_TIMELINE_BLOCKS)
    const sessions = tx.objectStore(STORE_WORK_SESSIONS)
    const all = await promisifyRequest<TimelineBlockRecord[]>(store.getAll())
    const base = all.find((block) => block.id === id)
    if (!base) throw new RangeError(`Work task "${id}" does not exist`)
    const now = new Date()
    if (action === 'start') {
      const active = all.find((block) => block.id !== id && block.status === 'in_progress' && block.timerStartedAt)
      if (active) throw new RangeError('another work timer is already running')
      if (base.status === 'completed' || base.status === 'skipped') throw new RangeError('completed task cannot be restarted')
      const record = buildBlockRecord({ id, status: 'in_progress', timerStartedAt: now.toISOString() }, base)
      store.put(record); await complete; return record
    }
    const status = action === 'complete' ? 'completed' : action === 'stop' ? 'planned' : 'paused'
    const settledSeconds = settleTimelineBlockSeconds(base, now.getTime())
    const record = buildBlockRecord({ id, status, elapsedSeconds: settledSeconds }, base)
    await recordTimerInterval(sessions, base, now)
    store.put(record); await complete; return record
  } catch (error) {
    try { tx.abort() } catch { /* transaction already closed */ }
    await complete.catch(() => undefined)
    throw error
  }
}

export function startWorkTaskTimer(id: string): Promise<TimelineBlockRecord> { return mutateWorkTimer(id, 'start') }
export function pauseWorkTaskTimer(id: string): Promise<TimelineBlockRecord> { return mutateWorkTimer(id, 'pause') }
/** Ends the current interval and returns the task to its scheduled state. */
export function stopWorkTaskTimer(id: string): Promise<TimelineBlockRecord> { return mutateWorkTimer(id, 'stop') }
export function completeWorkTask(id: string): Promise<TimelineBlockRecord> { return mutateWorkTimer(id, 'complete') }

export async function rolloverWorkTask(id: string, targetDate: string): Promise<TimelineBlockRecord> {
  const db = await getDatabase(); const tx = db.transaction([STORE_TIMELINE_BLOCKS, STORE_WORK_SESSIONS], 'readwrite'); const complete = awaitTransaction(tx)
  try {
    const store = tx.objectStore(STORE_TIMELINE_BLOCKS)
    const sessions = tx.objectStore(STORE_WORK_SESSIONS)
    const base = await promisifyRequest<TimelineBlockRecord | undefined>(store.get(id))
    if (!base) throw new RangeError(`Work task "${id}" does not exist`)
    if (base.status === 'completed' || base.status === 'skipped') throw new RangeError('completed task cannot be rolled over')
    const dateKey = targetDate || nextDateKey(base.dateKey)
    const oldStart = new Date(base.startTime)
    const newStart = new Date(`${dateKey}T${String(oldStart.getHours()).padStart(2,'0')}:${String(oldStart.getMinutes()).padStart(2,'0')}:00`)
    const newEnd = new Date(newStart.getTime() + base.durationMinutes * 60_000)
    if (intersectsLunch(newStart,newEnd)) throw new RangeError('work task cannot overlap the protected lunch slot')
    const scheduled = await promisifyRequest<TimelineBlockRecord[]>(store.index('by_date_key').getAll(dateKey))
    const settledSeconds = settleTimelineBlockSeconds(base)
    const record = buildBlockRecord({ id, startTime: newStart, endTime: newEnd, status: 'rolled_over', elapsedSeconds: settledSeconds, timerStartedAt: undefined, rolledOverFrom: base.dateKey }, base)
    if (findWorkTaskConflict(record, scheduled)) throw new RangeError('work task overlaps another scheduled work task')
    await recordTimerInterval(sessions, base, new Date())
    store.put(record); await complete; return record
  } catch (error) { try { tx.abort() } catch { /* transaction already closed */ }; await complete.catch(()=>undefined); throw error }
}

export async function countTimelineBlocks(): Promise<number> {
  const database = await getDatabase()
  return countRecords(database, STORE_TIMELINE_BLOCKS)
}

/**
 * Marks overlapping blocks on the same day.
 *
 * Overlap is a cross-record concern, so it is computed on read instead of being
 * denormalised into every write.
 */
export function markConflicts(
  blocks: TimelineBlockRecord[]
): TimelineBlockRecord[] {
  const ordered = sortByStartTime(blocks)
  const conflicting = new Set<string>()

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]
    for (let next = index + 1; next < ordered.length; next += 1) {
      const candidate = ordered[next]
      if (candidate.startTime >= current.endTime) break
      if (candidate.endTime > current.startTime) {
        conflicting.add(current.id)
        conflicting.add(candidate.id)
      }
    }
  }

  return ordered.map((block) => ({
    ...block,
    isConflictFree: !conflicting.has(block.id),
  }))
}

/** Blocks of a day with `isConflictFree` recomputed from real overlap. */
export async function getTimelineBlocksForDay(
  date: Date | string | number
): Promise<TimelineBlockRecord[]> {
  const blocks = await getTimelineBlocksByDate(date)
  return markConflicts(blocks)
}

export function summarizeTimelineDay(
  blocks: TimelineBlockRecord[]
): TimelineDaySummary {
  const summary: TimelineDaySummary = {
    dateKey: blocks[0]?.dateKey ?? toDateKey(new Date()),
    totalBlocks: blocks.length,
    completedBlocks: 0,
    skippedBlocks: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    conflictCount: 0,
    minutesByCategory: {
      work: 0,
      freelance: 0,
      study: 0,
      workout: 0,
      nutrition: 0,
      buffer: 0,
      sleep: 0,
    },
  }

  for (const block of blocks) {
    summary.plannedMinutes += block.durationMinutes
    summary.minutesByCategory[block.category] += block.durationMinutes
    if (!block.isConflictFree) summary.conflictCount += 1
    if (block.status === 'completed') {
      summary.completedBlocks += 1
      summary.completedMinutes += block.durationMinutes
    }
    if (block.status === 'skipped') summary.skippedBlocks += 1
  }

  return summary
}

/** Blocks of a day plus the derived summary, in a single call. */
export async function getTimelineDay(
  date: Date | string | number
): Promise<{ blocks: TimelineBlockRecord[]; summary: TimelineDaySummary }> {
  const blocks = await getTimelineBlocksForDay(date)
  return { blocks, summary: summarizeTimelineDay(blocks) }
}

// ---------------------------------------------------------------------------
// Work sessions
// ---------------------------------------------------------------------------

export async function getWorkSessionsByDate(
  date: Date | string | number,
  filter: WorkSessionFilter = 'all'
): Promise<WorkSessionRecord[]> {
  const database = await getDatabase()
  const dateKey = toDateKey(date)
  const kind = filter === 'work_only' ? 'company' : 'freelance'

  const records =
    filter === 'all'
      ? await getAllFromIndex<WorkSessionRecord>(
          database,
          STORE_WORK_SESSIONS,
          'by_date_key',
          dateKey
        )
      : await getAllFromIndex<WorkSessionRecord>(
          database,
          STORE_WORK_SESSIONS,
          'by_kind_date',
          IDBKeyRange.only([kind, dateKey])
        )

  return [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getWorkSessionsByRange(
  from: Date | string | number,
  to: Date | string | number,
  filter: WorkSessionFilter = 'all'
): Promise<WorkSessionRecord[]> {
  const range = resolveRange(from, to)
  if (!range) return []

  const database = await getDatabase()
  const records =
    filter === 'all'
      ? await getAllFromIndex<WorkSessionRecord>(
          database,
          STORE_WORK_SESSIONS,
          'by_date_key',
          range
        )
      : await getAllFromIndex<WorkSessionRecord>(
          database,
          STORE_WORK_SESSIONS,
          'by_kind_date',
          IDBKeyRange.bound(
            [filter === 'work_only' ? 'company' : 'freelance', toDateKey(from)],
            [filter === 'work_only' ? 'company' : 'freelance', toDateKey(to)]
          )
        )

  return [...records].sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

export async function getWorkSession(
  id: string
): Promise<WorkSessionRecord | undefined> {
  const database = await getDatabase()
  return getRecord<WorkSessionRecord>(database, STORE_WORK_SESSIONS, id)
}

function buildWorkSessionRecord(
  input: WorkSessionPatch,
  base?: WorkSessionRecord
): WorkSessionRecord {
  const now = toIsoString(new Date())
  const durationHours = input.durationHours ?? base?.durationHours
  if (typeof durationHours !== 'number') {
    throw new RangeError('durationHours is required to store a work session')
  }
  assertFinite(durationHours, 'durationHours')

  const isCompanyWork = input.isCompanyWork ?? base?.isCompanyWork ?? true
  const date = toIsoString(input.date ?? base?.date ?? now)

  return {
    id: input.id ?? base?.id ?? createId('session'),
    timelineBlockId: input.timelineBlockId ?? base?.timelineBlockId,
    clientName: assertNonEmpty(
      input.clientName ?? base?.clientName ?? '',
      'clientName'
    ),
    taskType: assertNonEmpty(
      String(input.taskType ?? base?.taskType ?? ''),
      'taskType'
    ),
    durationHours,
    date,
    isCompanyWork,
    notes: input.notes ?? base?.notes,
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
    dateKey: toDateKey(date),
    kind: isCompanyWork ? 'company' : 'freelance',
  }
}

export async function saveWorkSession(
  input: WorkSessionInput
): Promise<WorkSessionRecord> {
  const database = await getDatabase()
  const base = input.id
    ? await getRecord<WorkSessionRecord>(
        database,
        STORE_WORK_SESSIONS,
        input.id
      )
    : undefined

  const record = buildWorkSessionRecord(input, base)
  await putRecords(database, STORE_WORK_SESSIONS, [record])
  return record
}

export async function updateWorkSession(
  id: string,
  patch: WorkSessionPatch
): Promise<WorkSessionRecord> {
  const database = await getDatabase()
  const base = await getRecord<WorkSessionRecord>(
    database,
    STORE_WORK_SESSIONS,
    id
  )
  if (!base) {
    throw new RangeError(`Work session "${id}" does not exist`)
  }

  const record = buildWorkSessionRecord({ ...patch, id }, base)
  await putRecords(database, STORE_WORK_SESSIONS, [record])
  return record
}

export async function deleteWorkSession(id: string): Promise<void> {
  const database = await getDatabase()
  await deleteRecords(database, STORE_WORK_SESSIONS, [id])
}

export async function countWorkSessions(): Promise<number> {
  const database = await getDatabase()
  return countRecords(database, STORE_WORK_SESSIONS)
}

export function summarizeWorkSessions(
  sessions: WorkSessionRecord[],
  blocks: TimelineBlockRecord[] = []
): WorkTotals {
  const all = calculateWorkTime(blocks, sessions, 'all')
  const company = calculateWorkTime(blocks, sessions, 'company')
  const freelance = calculateWorkTime(blocks, sessions, 'freelance')
  const totals: WorkTotals = {
    totalHours: all.seconds / 3600,
    companyHours: company.seconds / 3600,
    freelanceHours: freelance.seconds / 3600,
    sessionCount: all.sessions.length + blocks.filter((block) => timelineBlockSeconds(block) > 0).length,
    clientNames: [],
  }
  totals.clientNames = [...new Set(all.sessions.map((session) => session.clientName))].sort((a, b) => a.localeCompare(b))
  return totals
}

export async function getWorkTotals(
  from: Date | string | number,
  to: Date | string | number,
  filter: WorkSessionFilter = 'all'
): Promise<WorkTotals> {
  const [sessions, blocks] = await Promise.all([getWorkSessionsByRange(from, to), getTimelineBlocksByRange(from, to)])
  const workBlocks = blocks.filter((block) => block.category === 'work' || block.category === 'freelance')
  const totals = summarizeWorkSessions(sessions, workBlocks)
  if (filter === 'work_only' || filter === 'freelance_only') {
    const mode = filter === 'work_only' ? 'company' : 'freelance'
    const selected = calculateWorkTime(workBlocks, sessions, mode)
    const selectedBlocks = workBlocks.filter((block) => mode === 'company' ? block.isCompanyWork !== false : block.isCompanyWork === false)
    return {
      ...totals,
      totalHours: selected.seconds / 3600,
      companyHours: mode === 'company' ? selected.seconds / 3600 : 0,
      freelanceHours: mode === 'freelance' ? selected.seconds / 3600 : 0,
      sessionCount: selected.sessions.length + selectedBlocks.filter((block) => timelineBlockSeconds(block) > 0).length,
    }
  }
  return totals
}

/** Hour totals per day key for the requested window, newest day last. */
export async function getWorkHoursByDay(
  from: Date | string | number,
  to: Date | string | number,
  filter: WorkSessionFilter = 'all'
): Promise<Array<{ dateKey: string; hours: number }>> {
  const keys = listDateKeys(from, to)
  if (keys.length === 0) return []

  const [sessions, blocks] = await Promise.all([getWorkSessionsByRange(from, to), getTimelineBlocksByRange(from, to)])
  const hoursByKey = new Map<string, number>(keys.map((key) => [key, 0]))
  const workBlocks = blocks.filter((block) => block.category === 'work' || block.category === 'freelance')
  for (const dateKey of keys) {
    const daySessions = sessions.filter((session) => session.dateKey === dateKey)
    const dayBlocks = workBlocks.filter((block) => block.dateKey === dateKey)
    const mode = filter === 'work_only' ? 'company' : filter === 'freelance_only' ? 'freelance' : 'all'
    const workTime = calculateWorkTime(dayBlocks, daySessions, mode)
    hoursByKey.set(dateKey, workTime.seconds / 3600)
  }

  return keys.map((dateKey) => ({
    dateKey,
    hours: hoursByKey.get(dateKey) ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// Energy logs
// ---------------------------------------------------------------------------

export async function getEnergyLogsByDate(
  date: Date | string | number
): Promise<EnergyLogRecord[]> {
  const database = await getDatabase()
  const records = await getAllFromIndex<EnergyLogRecord>(
    database,
    STORE_ENERGY_LOGS,
    'by_date_key',
    toDateKey(date)
  )
  return [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export async function getEnergyLogsByRange(
  from: Date | string | number,
  to: Date | string | number
): Promise<EnergyLogRecord[]> {
  const range = resolveRange(from, to)
  if (!range) return []

  const database = await getDatabase()
  const records = await getAllFromIndex<EnergyLogRecord>(
    database,
    STORE_ENERGY_LOGS,
    'by_date_key',
    range
  )
  return [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/** Latest check-in for a day (falls back to `undefined` when none logged). */
export async function getLatestEnergyLog(
  date: Date | string | number
): Promise<EnergyLogRecord | undefined> {
  const logs = await getEnergyLogsByDate(date)
  return logs.length > 0 ? logs[logs.length - 1] : undefined
}

export async function saveEnergyLog(
  input: EnergyLogInput
): Promise<EnergyLogRecord> {
  const database = await getDatabase()
  const base = input.id
    ? await getRecord<EnergyLogRecord>(database, STORE_ENERGY_LOGS, input.id)
    : undefined

  if (!isEnergyScore(input.score)) {
    throw new RangeError('score must be an integer between 1 and 5')
  }

  const now = toIsoString(new Date())
  const timestamp = toIsoString(input.timestamp ?? base?.timestamp ?? now)

  const record: EnergyLogRecord = {
    id: input.id ?? base?.id ?? createId('energy'),
    timestamp,
    score: input.score,
    note: input.note ?? base?.note ?? '',
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
    dateKey: toDateKey(timestamp),
  }

  await putRecords(database, STORE_ENERGY_LOGS, [record])
  return record
}

export async function updateEnergyLog(
  id: string,
  patch: EnergyLogPatch
): Promise<EnergyLogRecord> {
  const database = await getDatabase()
  const base = await getRecord<EnergyLogRecord>(database, STORE_ENERGY_LOGS, id)
  if (!base) {
    throw new RangeError(`Energy log "${id}" does not exist`)
  }

  const score = patch.score ?? base.score
  if (!isEnergyScore(score)) {
    throw new RangeError('score must be an integer between 1 and 5')
  }

  const now = toIsoString(new Date())
  const timestamp = toIsoString(patch.timestamp ?? base.timestamp)
  const record: EnergyLogRecord = {
    id: base.id,
    timestamp,
    score,
    note: patch.note ?? base.note,
    createdAt: base.createdAt,
    updatedAt: now,
    dateKey: toDateKey(timestamp),
  }

  await putRecords(database, STORE_ENERGY_LOGS, [record])
  return record
}

export async function deleteEnergyLog(id: string): Promise<void> {
  const database = await getDatabase()
  await deleteRecords(database, STORE_ENERGY_LOGS, [id])
}

export async function countEnergyLogs(): Promise<number> {
  const database = await getDatabase()
  return countRecords(database, STORE_ENERGY_LOGS)
}

/** Average score for a day, or `null` when nothing was logged. */
export async function getDailyEnergyScore(
  date: Date | string | number
): Promise<number | null> {
  const logs = await getEnergyLogsByDate(date)
  if (logs.length === 0) return null
  const total = logs.reduce((sum, log) => sum + log.score, 0)
  return Number((total / logs.length).toFixed(2))
}

/** One trend point per day in the window; days without logs are omitted. */
export async function getEnergyTrend(
  from: Date | string | number,
  to: Date | string | number
): Promise<EnergyTrendPoint[]> {
  const logs = await getEnergyLogsByRange(from, to)
  const grouped = new Map<string, EnergyLogRecord[]>()

  for (const log of logs) {
    const bucket = grouped.get(log.dateKey)
    if (bucket) {
      bucket.push(log)
    } else {
      grouped.set(log.dateKey, [log])
    }
  }

  return [...grouped.entries()]
    .map(([dateKey, entries]) => {
      const total = entries.reduce((sum, entry) => sum + entry.score, 0)
      const latest = entries[entries.length - 1] as EnergyLog
      return {
        dateKey,
        averageScore: Number((total / entries.length).toFixed(2)),
        latestScore: latest.score,
        logCount: entries.length,
      }
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

/** Average of the last `days` days including `date`; `null` when empty. */
export async function getEnergyAverage(
  date: Date | string | number,
  days = 7
): Promise<number | null> {
  const end = toDate(date)
  const start = addDays(end, -(Math.max(1, days) - 1))
  const logs = await getEnergyLogsByRange(start, end)
  if (logs.length === 0) return null
  const total = logs.reduce((sum, log) => sum + log.score, 0)
  return Number((total / logs.length).toFixed(2))
}

// ---------------------------------------------------------------------------
// Seeding / maintenance
// ---------------------------------------------------------------------------

/** Inserts the seed bundle. Idempotent by default (`onlyIfEmpty`). */
export async function seedDatabase(
  bundle: SeedBundle = buildSeedBundle(),
  options: { onlyIfEmpty?: boolean; reference?: Date } = {}
): Promise<SeedingResult> {
  const { onlyIfEmpty = true } = options
  const database = await getDatabase()

  const existing =
    (await countRecords(database, STORE_TIMELINE_BLOCKS)) +
    (await countRecords(database, STORE_WORK_SESSIONS)) +
    (await countRecords(database, STORE_ENERGY_LOGS))

  if (onlyIfEmpty && existing > 0) {
    return { seeded: false, counts: await getStoreCounts() }
  }

  await putRecords(database, STORE_TIMELINE_BLOCKS, bundle.timelineBlocks)
  await putRecords(database, STORE_WORK_SESSIONS, bundle.workSessions)
  await putRecords(database, STORE_ENERGY_LOGS, bundle.energyLogs)
  await putRecords<MetaRecord>(database, STORE_META, [
    {
      key: META_SEEDED_AT,
      value: toIsoString(options.reference ?? new Date()),
    },
  ])

  return { seeded: true, counts: await getStoreCounts() }
}

/** Record count of every store, used by the data and backup settings page. */
export async function getStoreCounts(): Promise<Record<string, number>> {
  const database = await getDatabase()
  const counts = await Promise.all(
    STORE_DEFINITIONS.map(
      async (definition) =>
        [definition.name, await countRecords(database, definition.name)] as const
    )
  )
  return Object.fromEntries(counts)
}

/**
 * Whether the sample seed bundle is present. Only the seeded stores count;
 * data of other modules (for example migrated legacy tasks) is not seed data.
 */
export async function hasSeededData(): Promise<boolean> {
  const database = await getDatabase()
  const [blocks, sessions, energy] = await Promise.all([
    countRecords(database, STORE_TIMELINE_BLOCKS),
    countRecords(database, STORE_WORK_SESSIONS),
    countRecords(database, STORE_ENERGY_LOGS),
  ])
  return blocks > 0 || sessions > 0 || energy > 0
}

/**
 * Opens and upgrades the local database without inserting sample data.
 *
 * Safe to call from app bootstrap and from React StrictMode double-invocation:
 * concurrent callers share one in-flight promise.
 */
export function initializeOfflineStorage(_reference?: Date): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = getDatabase().then(() => undefined).catch((error: unknown) => {
      initializationPromise = null
      throw error
    })
  }
  return initializationPromise
}

/** Removes every record but keeps the schema (used by tests/dev tools). */
export async function resetDatabase(): Promise<void> {
  const database = await getDatabase()
  await clearStores(database, [
    STORE_TIMELINE_BLOCKS,
    STORE_WORK_SESSIONS,
    STORE_ENERGY_LOGS,
    STORE_META,
    STORE_DASHBOARD_DAYS,
    STORE_WORKOUT_LOGS, STORE_VITALS, STORE_BODY_WEIGHTS, STORE_DINNER_LOGS,
    STORE_STUDY_LOGS, STORE_RADAR_SAVED, STORE_RADAR_ITEMS,
    STORE_FINANCE_ENTRIES, STORE_SOCIAL_DRAFTS, STORE_FINANCE_SETTINGS,
    STORE_NEWS_ITEMS, STORE_MEAL_LOGS, STORE_LEGACY_TASKS, STORE_STUDY_TIMERS,
    STORE_EDUCATION_ITEMS, STORE_PROJECTS, STORE_PROJECT_NOTES,
    STORE_SOCIAL_ACTIVITIES, STORE_CARDIO_LOGS,
    STORE_EDUCATION_TASKS, STORE_EDUCATION_REPORTS,
  ])
  initializationPromise = null
  startupRolloverPromise = null
}

/** Drops the whole database; mainly for tests and a "start over" action. */
export async function destroyDatabase(): Promise<void> {
  if (databasePromise) {
    const database = await databasePromise.catch(() => null)
    database?.close()
    databasePromise = null
  }
  initializationPromise = null
  startupRolloverPromise = null
  await deleteDatabase(DB_NAME)
}

/** Re-reads everything through the public API; handy for offline smoke tests. */
export async function readSnapshot(
  date: Date | string | number = new Date()
): Promise<{
  blocks: TimelineBlockRecord[]
  sessions: WorkSessionRecord[]
  energyLogs: EnergyLogRecord[]
  summary: TimelineDaySummary
  workTotals: WorkTotals
}> {
  const [blocks, sessions, energyLogs] = await Promise.all([
    getTimelineBlocksForDay(date),
    getWorkSessionsByDate(date),
    getEnergyLogsByDate(date),
  ])

  return {
    blocks,
    sessions,
    energyLogs,
    summary: summarizeTimelineDay(blocks),
    workTotals: summarizeWorkSessions(sessions, blocks.filter((block) => block.category === 'work' || block.category === 'freelance')),
  }
}

export { isIndexedDbAvailable }
export type { EnergyScore, TimelineBlock, WorkSession }

import type { TaskPriority, TimelineBlockRecord } from '@/types/timeline'
import { createId } from '@/lib/id'
import {
  getDatabase,
  STORE_PROJECT_NOTES,
  STORE_PROJECTS,
  STORE_TIMELINE_BLOCKS,
} from '@/services/db'
import {
  deleteRecords,
  getAllFromIndex,
  getAllRecords,
  getRecord,
  promisifyRequest,
  putRecords,
} from '@/services/idb'

export const PROJECT_STATUSES = [
  'planned',
  'active',
  'paused',
  'completed',
  'archived',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_PRIORITIES = ['low', 'medium', 'high'] as const
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]

/**
 * A personal project (machine learning, deep learning, AI or an experiment)
 * with optional links to the tasks that move it forward.
 */
export interface Project {
  id: string
  title: string
  description?: string
  status: ProjectStatus
  priority: ProjectPriority
  /** Gregorian day keys. */
  startDate?: string
  endDate?: string
  tags: string[]
  repositoryUrl?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectNote {
  id: string
  projectId: string
  text: string
  createdAt: string
}

export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

function assertDayKey(value: string | undefined, label: string): void {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${label} must use YYYY-MM-DD`)
  }
}

function buildProject(input: ProjectInput, base?: Project): Project {
  if (!input.title.trim()) throw new RangeError('project title is required')
  if (!PROJECT_STATUSES.includes(input.status))
    throw new RangeError('unknown project status')
  if (!PROJECT_PRIORITIES.includes(input.priority))
    throw new RangeError('unknown project priority')
  assertDayKey(input.startDate, 'start date')
  assertDayKey(input.endDate, 'end date')
  const now = new Date().toISOString()
  return {
    id: base?.id ?? input.id ?? createId('project'),
    title: input.title.trim(),
    ...(input.description !== undefined
      ? { description: input.description.trim() }
      : {}),
    status: input.status,
    priority: input.priority,
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    ...(input.repositoryUrl
      ? { repositoryUrl: input.repositoryUrl.trim() }
      : {}),
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
  }
}

export async function getProjects(): Promise<Project[]> {
  const db = await getDatabase()
  const rows = await getAllRecords<Project>(db, STORE_PROJECTS)
  return [...rows].sort(
    (a, b) =>
      a.status.localeCompare(b.status) || b.updatedAt.localeCompare(a.updatedAt)
  )
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDatabase()
  return getRecord<Project>(db, STORE_PROJECTS, id)
}

export async function saveProject(input: ProjectInput): Promise<Project> {
  const db = await getDatabase()
  const base = input.id
    ? await getRecord<Project>(db, STORE_PROJECTS, input.id)
    : undefined
  const record = buildProject(input, base)
  await putRecords(db, STORE_PROJECTS, [record])
  return record
}

export async function updateProject(
  id: string,
  patch: Partial<ProjectInput>
): Promise<Project> {
  const db = await getDatabase()
  const base = await getRecord<Project>(db, STORE_PROJECTS, id)
  if (!base) throw new RangeError(`Project "${id}" does not exist`)
  const record = buildProject({ ...base, ...patch, id }, base)
  await putRecords(db, STORE_PROJECTS, [record])
  return record
}

/**
 * Deletes a project but keeps its tasks: the tasks only lose the link, so no
 * logged time is lost.
 */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDatabase()
  const transaction = db.transaction(
    [STORE_PROJECTS, STORE_PROJECT_NOTES, STORE_TIMELINE_BLOCKS],
    'readwrite'
  )
  const blocks = await promisifyRequest<TimelineBlockRecord[]>(
    transaction.objectStore(STORE_TIMELINE_BLOCKS).getAll()
  )
  for (const block of blocks) {
    if (block.projectId !== id) continue
    transaction.objectStore(STORE_TIMELINE_BLOCKS).put({
      ...block,
      projectId: undefined,
      updatedAt: new Date().toISOString(),
    })
  }
  const notes = await promisifyRequest<ProjectNote[]>(
    transaction.objectStore(STORE_PROJECT_NOTES).getAll()
  )
  for (const note of notes) {
    if (note.projectId === id)
      transaction.objectStore(STORE_PROJECT_NOTES).delete(note.id)
  }
  transaction.objectStore(STORE_PROJECTS).delete(id)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

/** Tasks that are linked to a project. */
export async function getProjectTasks(
  projectId: string
): Promise<TimelineBlockRecord[]> {
  const db = await getDatabase()
  const blocks = await getAllRecords<TimelineBlockRecord>(
    db,
    STORE_TIMELINE_BLOCKS
  )
  return blocks
    .filter((block) => block.projectId === projectId)
    .sort(
      (a, b) =>
        a.dateKey.localeCompare(b.dateKey) ||
        a.startTime.localeCompare(b.startTime)
    )
}

/** Progress notes attached to a project. */
export async function getProjectNotes(
  projectId: string
): Promise<ProjectNote[]> {
  const db = await getDatabase()
  const rows = await getAllFromIndex<ProjectNote>(
    db,
    STORE_PROJECT_NOTES,
    'by_project',
    projectId
  )
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function saveProjectNote(
  projectId: string,
  text: string
): Promise<ProjectNote> {
  if (!text.trim()) throw new RangeError('note text is required')
  const db = await getDatabase()
  const record: ProjectNote = {
    id: createId('note'),
    projectId,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  }
  await putRecords(db, STORE_PROJECT_NOTES, [record])
  return record
}

export async function deleteProjectNote(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_PROJECT_NOTES, [id])
}

/** Priority helper shared with the task form. */
export function isProjectPriority(value: unknown): value is ProjectPriority {
  return PROJECT_PRIORITIES.some((priority) => priority === value)
}

/** Priority helper shared with the task form. */
export function isTaskPriorityValue(value: unknown): value is TaskPriority {
  return ['low', 'medium', 'high', 'urgent'].some(
    (priority) => priority === value
  )
}

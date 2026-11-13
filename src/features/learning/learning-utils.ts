import type { LearningTrack, StudyLog } from '@/services/db'
import type { EducationItem } from '@/services/learning'

/**
 * Older versions stored three study categories (`ml`, `exam`, `coding`).
 * They are mapped onto the three independent tracks so no recorded session is
 * lost when the learning module is used for the first time.
 */
export const LEGACY_TRACK_BY_CATEGORY: Record<
  StudyLog['category'],
  LearningTrack
> = {
  ml: 'masters',
  exam: 'university',
  coding: 'course',
}

/** Track a study session belongs to. */
export function trackOfLog(
  log: Pick<StudyLog, 'track' | 'category'>
): LearningTrack {
  return log.track ?? LEGACY_TRACK_BY_CATEGORY[log.category] ?? 'masters'
}

export interface TrackSummary {
  track: LearningTrack
  /** Minutes studied in this track. */
  minutes: number
  /** Number of finished sessions. */
  sessions: number
  /** Number of subjects, topics or courses in the track. */
  itemCount: number
  completedItems: number
  /** Average manual progress of the track items in percent. */
  averageProgress: number
}

/** Progress report of a single learning track. */
export function summarizeTrack(
  track: LearningTrack,
  items: EducationItem[],
  logs: StudyLog[]
): TrackSummary {
  const trackItems = items.filter((item) => item.track === track)
  const trackLogs = logs.filter((log) => trackOfLog(log) === track)
  const progress = trackItems.reduce((sum, item) => sum + item.progress, 0)
  return {
    track,
    minutes: trackLogs.reduce((sum, log) => sum + log.minutes, 0),
    sessions: trackLogs.length,
    itemCount: trackItems.length,
    completedItems: trackItems.filter((item) => item.status === 'completed').length,
    averageProgress: trackItems.length ? Math.round(progress / trackItems.length) : 0,
  }
}

export interface LearningOverview {
  /** Minutes across the three tracks. */
  totalMinutes: number
  sessions: number
  byTrack: Record<LearningTrack, number>
}

/** Combined report of the three learning tracks. */
export function summarizeLearning(logs: StudyLog[]): LearningOverview {
  const byTrack: Record<LearningTrack, number> = {
    masters: 0,
    university: 0,
    course: 0,
  }
  let totalMinutes = 0
  for (const log of logs) {
    const track = trackOfLog(log)
    byTrack[track] += log.minutes
    totalMinutes += log.minutes
  }
  return {
    totalMinutes,
    sessions: logs.length,
    byTrack,
  }
}

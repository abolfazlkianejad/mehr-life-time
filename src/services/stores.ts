/**
 * Names of the IndexedDB stores.
 *
 * They live in their own module so domain services (learning, projects,
 * social, nutrition) can reference a store without importing the whole data
 * layer and creating an import cycle.
 */

export const STORE_TIMELINE_BLOCKS = 'timelineBlocks'
export const STORE_WORK_SESSIONS = 'workSessions'
export const STORE_ENERGY_LOGS = 'energyLogs'
export const STORE_META = 'meta'
export const STORE_DASHBOARD_DAYS = 'dashboardDays'
export const STORE_WORKOUT_LOGS = 'workoutLogs'
export const STORE_VITALS = 'vitals'
export const STORE_BODY_WEIGHTS = 'bodyWeights'
export const STORE_DINNER_LOGS = 'dinnerLogs'
export const STORE_STUDY_LOGS = 'studyLogs'
export const STORE_RADAR_SAVED = 'radarSaved'
export const STORE_FINANCE_ENTRIES = 'financeEntries'
export const STORE_SOCIAL_DRAFTS = 'socialDrafts'
export const STORE_FINANCE_SETTINGS = 'financeSettings'
export const STORE_NEWS_ITEMS = 'newsItems'
export const STORE_MEAL_LOGS = 'mealLogs'
// Exact, unscheduled task records migrated from the first local prototype.
export const STORE_LEGACY_TASKS = 'legacyTasks'
export const STORE_RADAR_ITEMS = 'radarItems'
export const STORE_STUDY_TIMERS = 'studyTimers'
// v10 stores: independent learning tracks, personal projects, social media
// activities and cardio sessions (the calorie source of the nutrition module).
export const STORE_EDUCATION_ITEMS = 'educationItems'
export const STORE_PROJECTS = 'projects'
export const STORE_PROJECT_NOTES = 'projectNotes'
export const STORE_SOCIAL_ACTIVITIES = 'socialActivities'
export const STORE_CARDIO_LOGS = 'cardioLogs'
// v11 stores: the shared task and progress-report history of the three
// independent education paths.
export const STORE_EDUCATION_TASKS = 'educationTasks'
export const STORE_EDUCATION_REPORTS = 'educationReports'
// v12 stores: weekly gym plans, their exercises and the real performance
// sessions with per-exercise sets. Session history is independent of the plan.
export const STORE_GYM_PLANS = 'gymPlans'
export const STORE_GYM_EXERCISES = 'gymExercises'
export const STORE_GYM_SESSIONS = 'gymSessions'
export const STORE_GYM_SESSION_SETS = 'gymSessionSets'
// v13 store: busy/free windows declared by the user or the planner agent.
export const STORE_PLANNER_AVAILABILITY = 'plannerAvailability'
// v14 stores: daily/weekly goals and desktop alarm reminders. Both are
// additive settings/reminders; historical activity stays in its own stores and
// is never copied here.
export const STORE_GOALS = 'goals'
export const STORE_ALARMS = 'alarms'

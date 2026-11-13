import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderGit2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { HeaderActions } from '@/components/header-actions'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import {
  deleteProject,
  deleteProjectNote,
  getProjectNotes,
  getProjects,
  getProjectTasks,
  saveProject,
  saveProjectNote,
  updateProject,
  type Project,
  type ProjectNote,
  type ProjectPriority,
  type ProjectStatus,
} from '@/services/projects'
import { projectProgress } from '@/features/projects/project-utils'
import { formatJalaliDateKey } from '@/lib/jalali'
import type { TimelineBlockRecord } from '@/types/timeline'

interface ProjectFormState {
  id?: string
  title: string
  description: string
  status: ProjectStatus
  priority: ProjectPriority
  startDate: string
  endDate: string
  tags: string
  repositoryUrl: string
}

const emptyForm = (): ProjectFormState => ({
  title: '',
  description: '',
  status: 'planned',
  priority: 'medium',
  startDate: '',
  endDate: '',
  tags: '',
  repositoryUrl: '',
})

interface ProjectView {
  project: Project
  tasks: TimelineBlockRecord[]
  notes: ProjectNote[]
}

export function ProjectsPage() {
  const { t } = useTranslation()
  const [views, setViews] = useState<ProjectView[]>([])
  const [form, setForm] = useState<ProjectFormState>(emptyForm)
  const [noteText, setNoteText] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const projects = await getProjects()
    const detailed = await Promise.all(
      projects.map(async (project) => ({
        project,
        tasks: await getProjectTasks(project.id),
        notes: await getProjectNotes(project.id),
      }))
    )
    setViews(detailed)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    void load()
      .catch(() => setError(t('projects.errors.load')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only depends on the translator
  }, [t])

  const visible = useMemo(
    () =>
      statusFilter === 'all'
        ? views
        : views.filter((view) => view.project.status === statusFilter),
    [views, statusFilter]
  )

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!form.title.trim()) {
      setError(t('projects.errors.invalid'))
      return
    }
    const payload = {
      title: form.title,
      description: form.description,
      status: form.status,
      priority: form.priority,
      tags: form.tags.split(/[,،]/),
      ...(form.startDate ? { startDate: form.startDate } : {}),
      ...(form.endDate ? { endDate: form.endDate } : {}),
      ...(form.repositoryUrl.trim() ? { repositoryUrl: form.repositoryUrl.trim() } : {}),
    }
    try {
      if (form.id) await updateProject(form.id, payload)
      else await saveProject(payload)
      setForm(emptyForm())
      await load()
    } catch {
      setError(t('projects.errors.save'))
    }
  }

  const remove = async (project: Project) => {
    if (!window.confirm(t('projects.confirmDelete'))) return
    try {
      await deleteProject(project.id)
      if (form.id === project.id) setForm(emptyForm())
      await load()
    } catch {
      setError(t('projects.errors.save'))
    }
  }

  const edit = (project: Project) => {
    setForm({
      id: project.id,
      title: project.title,
      description: project.description ?? '',
      status: project.status,
      priority: project.priority,
      startDate: project.startDate ?? '',
      endDate: project.endDate ?? '',
      tags: project.tags.join('، '),
      repositoryUrl: project.repositoryUrl ?? '',
    })
  }

  const addNote = async (projectId: string) => {
    const text = noteText[projectId] ?? ''
    if (!text.trim()) return
    try {
      await saveProjectNote(projectId, text)
      setNoteText((all) => ({ ...all, [projectId]: '' }))
      await load()
    } catch {
      setError(t('projects.errors.save'))
    }
  }

  const removeNote = async (note: ProjectNote) => {
    try {
      await deleteProjectNote(note.id)
      await load()
    } catch {
      setError(t('projects.errors.save'))
    }
  }

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('projects.title')}</h2>
          <p className='text-muted-foreground'>{t('projects.subtitle')}</p>
        </div>

        {error ? <p role='alert' className='text-sm text-destructive'>{error}</p> : null}

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Plus className='size-5' />
              {form.id ? t('projects.editProject') : t('projects.addProject')}
            </CardTitle>
            <CardDescription>{t('projects.formHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className='grid gap-3 md:grid-cols-2 xl:grid-cols-3' onSubmit={(event) => void save(event)}>
              <Input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder={t('projects.titlePlaceholder')}
              />
              <select
                aria-label={t('projects.status')}
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as ProjectStatus })}
              >
                {(['planned', 'active', 'paused', 'completed', 'archived'] as const).map((status) => (
                  <option key={status} value={status}>
                    {t(`projects.statuses.${status}`)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('projects.priority')}
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={form.priority}
                onChange={(event) => setForm({ ...form, priority: event.target.value as ProjectPriority })}
              >
                {(['low', 'medium', 'high'] as const).map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`projects.priorities.${priority}`)}
                  </option>
                ))}
              </select>
              <JalaliDatePicker
                value={form.startDate}
                onChange={(dateKey) => setForm({ ...form, startDate: dateKey })}
                ariaLabel={t('projects.startDate')}
                clearable
              />
              <JalaliDatePicker
                value={form.endDate}
                onChange={(dateKey) => setForm({ ...form, endDate: dateKey })}
                ariaLabel={t('projects.endDate')}
                clearable
              />
              <Input
                value={form.tags}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
                placeholder={t('projects.tags')}
              />
              <Input
                className='md:col-span-2 xl:col-span-2'
                value={form.repositoryUrl}
                onChange={(event) => setForm({ ...form, repositoryUrl: event.target.value })}
                placeholder={t('projects.repository')}
              />
              <Textarea
                className='md:col-span-2 xl:col-span-3'
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder={t('projects.description')}
              />
              <div className='flex gap-2 md:col-span-2 xl:col-span-3'>
                <Button type='submit'>
                  <FolderGit2 className='me-2 size-4' />
                  {form.id ? t('projects.update') : t('projects.save')}
                </Button>
                {form.id ? (
                  <Button type='button' variant='outline' onClick={() => setForm(emptyForm())}>
                    <X className='me-2 size-4' />
                    {t('projects.cancel')}
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <div className='flex flex-wrap gap-2'>
          <Button variant={statusFilter === 'all' ? 'secondary' : 'outline'} size='sm' onClick={() => setStatusFilter('all')}>
            {t('projects.allStatuses')}
          </Button>
          {(['planned', 'active', 'paused', 'completed', 'archived'] as const).map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'secondary' : 'outline'}
              size='sm'
              onClick={() => setStatusFilter(status)}
            >
              {t(`projects.statuses.${status}`)}
            </Button>
          ))}
        </div>

        {loading ? (
          <p role='status' className='text-sm text-muted-foreground'>{t('projects.loading')}</p>
        ) : visible.length ? (
          <div className='grid gap-4 lg:grid-cols-2'>
            {visible.map(({ project, tasks, notes }) => {
              const progress = projectProgress(tasks)
              return (
                <Card key={project.id}>
                  <CardHeader>
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                      <div>
                        <CardTitle className='text-lg'>{project.title}</CardTitle>
                        <CardDescription>
                          {t(`projects.statuses.${project.status}`)} · {t(`projects.priorities.${project.priority}`)}
                          {project.startDate ? ` · ${t('projects.startDate')}: ${formatJalaliDateKey(project.startDate)}` : ''}
                          {project.endDate ? ` · ${t('projects.endDate')}: ${formatJalaliDateKey(project.endDate)}` : ''}
                        </CardDescription>
                      </div>
                      <div className='flex gap-1'>
                        <Button size='icon' variant='ghost' aria-label={t('projects.edit')} onClick={() => edit(project)}>
                          <Pencil className='size-4' />
                        </Button>
                        <Button size='icon' variant='ghost' aria-label={t('projects.delete')} onClick={() => void remove(project)}>
                          <Trash2 className='size-4' />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    {project.description ? <p className='text-sm text-muted-foreground'>{project.description}</p> : null}
                    {project.tags.length ? (
                      <div className='flex flex-wrap gap-1'>
                        {project.tags.map((tag) => (
                          <Badge key={tag} variant='outline'>{tag}</Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className='flex flex-wrap items-center gap-2'>
                      <Badge variant='secondary'>{t('projects.progress')}: {progress.percent}%</Badge>
                      <Badge variant='outline'>
                        {t('projects.tasksDone')}: {progress.done} / {progress.total}
                      </Badge>
                      <Badge variant='outline'>{t('projects.tasksRemaining')}: {progress.remaining}</Badge>
                    </div>
                    <div className='space-y-1 text-sm'>
                      <p className='font-medium'>{t('projects.linkedTasks')}</p>
                      {tasks.length ? (
                        tasks.map((task) => (
                          <div key={task.id} className='flex items-center justify-between gap-2 border-b py-1 text-xs'>
                            <span>{task.title}</span>
                            <Badge variant={task.status === 'completed' ? 'secondary' : 'outline'}>
                              {t(`tasks.status.${task.status}`)}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <p className='text-muted-foreground'>{t('projects.noLinkedTasks')}</p>
                      )}
                    </div>
                    <div className='space-y-2'>
                      <p className='text-sm font-medium'>{t('projects.notes')}</p>
                      {notes.length ? (
                        notes.map((note) => (
                          <div key={note.id} className='flex items-start justify-between gap-2 rounded-md border p-2 text-sm'>
                            <span>{note.text}</span>
                            <Button size='icon' variant='ghost' aria-label={t('projects.deleteNote')} onClick={() => void removeNote(note)}>
                              <Trash2 className='size-4' />
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className='text-xs text-muted-foreground'>{t('projects.noNotes')}</p>
                      )}
                      <div className='flex gap-2'>
                        <Input
                          value={noteText[project.id] ?? ''}
                          onChange={(event) => setNoteText((all) => ({ ...all, [project.id]: event.target.value }))}
                          placeholder={t('projects.notePlaceholder')}
                        />
                        <Button variant='outline' onClick={() => void addNote(project.id)}>
                          {t('projects.addNote')}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>{t('projects.empty')}</p>
        )}
      </Main>
    </>
  )
}

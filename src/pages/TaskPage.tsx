import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { StatusBadge } from '../components/StatusBadge'
import { errorText } from '../lib/errors'
import { formatDateTime, personName } from '../lib/format'
import { STATUS_LABEL, actionLabel, availableActions } from '../lib/labels'
import { supabase } from '../lib/supabase'
import type { HistoryEntry, ObjectRef, Person, TaskStatus } from '../types'

type TaskDetails = {
  id: string
  title: string
  description: string
  status: TaskStatus
  created_at: string
  assignee_id: string
  author_id: string
  assignee: Person | Person[] | null
  author: Person | Person[] | null
  object: ObjectRef | ObjectRef[] | null
}

const TASK_SELECT = `
  id, title, description, status, created_at, assignee_id, author_id,
  assignee:profiles!tasks_assignee_id_fkey(id, full_name),
  author:profiles!tasks_author_id_fkey(id, full_name),
  object:objects!tasks_object_id_fkey(id, name, address)
`

export function TaskPage() {
  const { taskId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [task, setTask] = useState<TaskDetails | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [pending, setPending] = useState<TaskStatus | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!taskId) return
    const [taskResult, historyResult] = await Promise.all([
      supabase.from('tasks').select(TASK_SELECT).eq('id', taskId).maybeSingle(),
      supabase
        .from('task_status_history')
        .select(
          'id, from_status, to_status, comment, created_at, changed_by, actor:profiles!task_status_history_changed_by_fkey(id, full_name)',
        )
        .eq('task_id', taskId)
        .order('created_at', { ascending: true }),
    ])

    if (taskResult.error || !taskResult.data) {
      setTask(null)
      setError(errorText(taskResult.error, 'Задача не найдена или нет доступа'))
    } else {
      const next = taskResult.data as TaskDetails
      setTask(next)
      document.title = `${next.title} — CRM`
      setError(null)
    }

    if (historyResult.error) setError(errorText(historyResult.error, 'Не удалось загрузить историю'))
    else setHistory((historyResult.data ?? []) as HistoryEntry[])
    setLoading(false)
  }, [taskId])

  useEffect(() => {
    document.title = 'Задача — CRM'
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      void load()
    })
    return () => {
      active = false
    }
  }, [load])

  async function transit(to: TaskStatus) {
    if (!task) return
    if (to === 'rework' && comment.trim() === '') {
      setError('При возврате на доработку нужен комментарий')
      return
    }
    setPending(to)
    setError(null)
    const { error: rpcError } = await supabase.rpc('transition_task', {
      p_task_id: task.id,
      p_to_status: to,
      p_comment: comment.trim() || null,
    })
    if (rpcError) {
      setError(errorText(rpcError))
      setPending(null)
      return
    }
    setComment('')
    await load()
    setPending(null)
  }

  async function removeTask() {
    if (!task) return
    setDeleting(true)
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', task.id)
    if (deleteError) {
      setError(errorText(deleteError, 'Не удалось удалить задачу'))
      setDeleting(false)
      return
    }
    const objectId = Array.isArray(task.object) ? task.object[0]?.id : task.object?.id
    navigate(objectId ? `/objects/${objectId}` : '/objects')
  }

  if (loading) return <p className="muted">Загрузка…</p>
  if (!task || !profile) return <p className="form-error">{error ?? 'Задача не найдена или нет доступа'}</p>

  const object = Array.isArray(task.object) ? task.object[0] : task.object
  const actions = availableActions(profile.role, task.status, task.assignee_id === profile.id)
  const assigner = profile.role === 'assigner'

  return (
    <section>
      {object ? (
        <Link className="back" to={`/objects/${object.id}`}>
          {object.name}
        </Link>
      ) : (
        <Link className="back" to="/objects">
          Объекты
        </Link>
      )}

      <div className="page-head">
        <div>
          <p className="eyebrow">Задача</p>
          <h1>{task.title}</h1>
          <div className="badge-row">
            <StatusBadge status={task.status} />
          </div>
        </div>
        {assigner && (
          <div className="button-row">
            <Link className="btn btn-secondary" to={`/tasks/${task.id}/edit`}>
              Редактировать
            </Link>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Удалить
            </button>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {confirmDelete && (
        <div className="confirm">
          <p>Удалить задачу? История её статусов тоже будет удалена.</p>
          <div className="button-row">
            <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => void removeTask()}>
              {deleting ? 'Удаляем…' : 'Удалить задачу'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      <div className="split">
        <article className="panel">
          <dl className="facts">
            <div>
              <dt>Объект</dt>
              <dd>{object ? `${object.name}, ${object.address}` : 'Недоступен'}</dd>
            </div>
            <div>
              <dt>Исполнитель</dt>
              <dd>{personName(task.assignee)}</dd>
            </div>
            <div>
              <dt>Автор</dt>
              <dd>{personName(task.author)}</dd>
            </div>
            <div>
              <dt>Создана</dt>
              <dd>{formatDateTime(task.created_at)}</dd>
            </div>
          </dl>
          <h2>Описание</h2>
          <p className="description">{task.description.trim() || 'Без описания.'}</p>

          <h2>Действия</h2>
          {actions.length === 0 ? (
            <p className="muted">
              {task.status === 'accepted'
                ? 'Задача принята. Доступных действий нет.'
                : 'В этом статусе вам нечего менять. Кнопки чужих переходов скрыты, база их всё равно не пропустит.'}
            </p>
          ) : (
            <div className="action-box">
              <label>
                Комментарий
                {actions.includes('rework') ? ' (обязателен для возврата на доработку)' : ' (необязательно)'}
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </label>
              <div className="button-row">
                {actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={action === 'rework' ? 'btn btn-danger' : 'btn btn-primary'}
                    disabled={pending !== null}
                    onClick={() => void transit(action)}
                  >
                    {pending === action ? 'Сохраняем…' : actionLabel(task.status, action)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </article>

        <article className="panel">
          <h2>История</h2>
          {history.length === 0 ? (
            <p className="muted">Записей пока нет.</p>
          ) : (
            <ol className="timeline">
              {history.map((entry) => (
                <li key={entry.id}>
                  <p className="timeline-title">
                    {entry.from_status
                      ? `${STATUS_LABEL[entry.from_status]} → ${STATUS_LABEL[entry.to_status]}`
                      : 'Задача создана'}
                  </p>
                  <p className="muted">
                    {personName(entry.actor)} · {formatDateTime(entry.created_at)}
                  </p>
                  {entry.comment && <p className="comment">{entry.comment}</p>}
                </li>
              ))}
            </ol>
          )}
        </article>
      </div>
    </section>
  )
}

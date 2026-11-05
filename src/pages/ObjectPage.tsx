import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { StatusBadge } from '../components/StatusBadge'
import { errorText } from '../lib/errors'
import { formatDateTime, personName } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Person, TaskStatus } from '../types'

type TaskRow = {
  id: string
  title: string
  status: TaskStatus
  created_at: string
  assignee: Person | Person[] | null
}

type ObjectRow = {
  id: string
  name: string
  address: string
}

export function ObjectPage() {
  const { objectId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [object, setObject] = useState<ObjectRow | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    document.title = 'Объект — CRM'
    if (!objectId) return
    let active = true

    void Promise.all([
      supabase.from('objects').select('id, name, address').eq('id', objectId).maybeSingle(),
      supabase
        .from('tasks')
        .select('id, title, status, created_at, assignee:profiles!tasks_assignee_id_fkey(id, full_name)')
        .eq('object_id', objectId)
        .order('created_at', { ascending: false }),
    ]).then(([objectResult, taskResult]) => {
      if (!active) return
      if (objectResult.error || !objectResult.data) {
        setError(errorText(objectResult.error, 'Объект не найден или нет доступа'))
      } else {
        setObject(objectResult.data)
        document.title = `${objectResult.data.name} — CRM`
      }
      if (taskResult.error) setError(errorText(taskResult.error, 'Не удалось загрузить задачи'))
      else setTasks((taskResult.data ?? []) as TaskRow[])
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [objectId])

  async function removeObject() {
    if (!objectId) return
    setDeleting(true)
    const { error: deleteError } = await supabase.from('objects').delete().eq('id', objectId)
    if (deleteError) {
      setError(errorText(deleteError, 'Не удалось удалить объект'))
      setDeleting(false)
      return
    }
    navigate('/objects')
  }

  if (loading) return <p className="muted">Загрузка…</p>
  if (!object) return <p className="form-error">{error ?? 'Объект не найден или нет доступа'}</p>

  const assigner = profile?.role === 'assigner'

  return (
    <section>
      <Link className="back" to="/objects">
        Все объекты
      </Link>
      <div className="page-head">
        <div>
          <p className="eyebrow">Объект</p>
          <h1>{object.name}</h1>
          <p className="address">{object.address}</p>
        </div>
        {assigner && (
          <div className="button-row">
            <Link className="btn btn-secondary" to={`/objects/${object.id}/edit`}>
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
          <p>
            Удалить объект «{object.name}»? Задачи этого объекта и их история тоже будут удалены.
          </p>
          <div className="button-row">
            <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => void removeObject()}>
              {deleting ? 'Удаляем…' : 'Удалить объект'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      <div className="section-head">
        <h2>Задачи</h2>
        {assigner && (
          <Link className="btn btn-primary" to={`/objects/${object.id}/tasks/new`}>
            Новая задача
          </Link>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="empty">
          <h2>Задач не видно</h2>
          <p>
            {assigner
              ? 'Поставьте первую задачу и назначьте исполнителя.'
              : 'На этом объекте у вас нет задач. Чужие задачи здесь не показываются.'}
          </p>
        </div>
      ) : (
        <div className="list">
          {tasks.map((task) => (
            <Link key={task.id} className="list-row" to={`/tasks/${task.id}`}>
              <div>
                <strong>{task.title}</strong>
                <p className="muted">
                  {personName(task.assignee)} · {formatDateTime(task.created_at)}
                </p>
              </div>
              <StatusBadge status={task.status} />
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

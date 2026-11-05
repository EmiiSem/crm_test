import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
import { errorText } from '../lib/errors'
import { STATUS_LABEL, STATUS_ORDER } from '../lib/labels'
import { supabase } from '../lib/supabase'
import type { ObjectRef, TaskStatus } from '../types'

type MyTask = {
  id: string
  title: string
  status: TaskStatus
  object: ObjectRef | ObjectRef[] | null
}

export function MyTasksPage() {
  const [tasks, setTasks] = useState<MyTask[]>([])
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Мои задачи — CRM'
    let active = true
    void supabase
      .from('tasks')
      .select('id, title, status, object:objects!tasks_object_id_fkey(id, name, address)')
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(errorText(queryError, 'Не удалось загрузить задачи'))
        else setTasks((data ?? []) as MyTask[])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const visible = tasks.filter((task) => filter === 'all' || task.status === filter)

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="eyebrow">Исполнитель</p>
          <h1>Мои задачи</h1>
          <p className="lede">Здесь только задачи, назначенные вам. Чужие в этот список не попадают.</p>
        </div>
      </div>

      <div className="filters">
        <button
          type="button"
          className={filter === 'all' ? 'chip active' : 'chip'}
          onClick={() => setFilter('all')}
        >
          Все
        </button>
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            className={filter === status ? 'chip active' : 'chip'}
            onClick={() => setFilter(status)}
          >
            {STATUS_LABEL[status]}
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">Загрузка…</p>}
      {!loading && visible.length === 0 && (
        <div className="empty">
          <h2>Задач нет</h2>
          <p>В выбранном статусе назначенных вам задач не найдено.</p>
        </div>
      )}

      <div className="list">
        {visible.map((task) => {
          const object = Array.isArray(task.object) ? task.object[0] : task.object
          return (
            <Link key={task.id} className="list-row" to={`/tasks/${task.id}`}>
              <div>
                <strong>{task.title}</strong>
                <p className="muted">{object ? `${object.name}, ${object.address}` : 'Объект недоступен'}</p>
              </div>
              <StatusBadge status={task.status} />
            </Link>
          )
        })}
      </div>
    </section>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { StatusBadge } from '../components/StatusBadge'
import { errorText } from '../lib/errors'
import { STATUS_ORDER } from '../lib/labels'
import { supabase } from '../lib/supabase'
import type { TaskStatus } from '../types'

type ObjectCard = {
  id: string
  name: string
  address: string
  tasks: { status: TaskStatus }[] | null
}

export function ObjectsPage() {
  const { profile } = useAuth()
  const [objects, setObjects] = useState<ObjectCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Объекты — CRM'
    let active = true
    void supabase
      .from('objects')
      .select('id, name, address, tasks(status)')
      .order('name')
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(errorText(queryError, 'Не удалось загрузить объекты'))
        else setObjects((data ?? []) as ObjectCard[])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="eyebrow">Стройки</p>
          <h1>Объекты</h1>
          <p className="lede">
            {profile?.role === 'assigner'
              ? 'Все объекты компании и задачи по ним.'
              : 'Только объекты, где у вас есть задачи.'}
          </p>
        </div>
        {profile?.role === 'assigner' && (
          <Link className="btn btn-primary" to="/objects/new">
            Новый объект
          </Link>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">Загрузка…</p>}
      {!loading && objects.length === 0 && (
        <div className="empty">
          <h2>Объектов пока нет</h2>
          <p>
            {profile?.role === 'assigner'
              ? 'Создайте первую стройку, затем поставьте по ней задачи.'
              : 'Когда постановщик назначит вам задачу, объект появится здесь.'}
          </p>
        </div>
      )}

      <div className="card-grid">
        {objects.map((object) => {
          const tasks = object.tasks ?? []
          const counts = STATUS_ORDER.map((status) => ({
            status,
            count: tasks.filter((task) => task.status === status).length,
          })).filter((item) => item.count > 0)

          return (
            <Link key={object.id} className="object-card" to={`/objects/${object.id}`}>
              <h2>{object.name}</h2>
              <p className="address">{object.address}</p>
              <p className="muted">{tasks.length === 0 ? 'Нет задач' : `Задач: ${tasks.length}`}</p>
              {counts.length > 0 && (
                <div className="badge-row">
                  {counts.map((item) => (
                    <StatusBadge key={item.status} status={item.status} count={item.count} />
                  ))}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

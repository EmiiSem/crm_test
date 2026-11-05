import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { errorText } from '../lib/errors'
import { supabase } from '../lib/supabase'

type Option = { id: string; name?: string; full_name?: string }

export function TaskFormPage() {
  const { objectId, taskId } = useParams()
  const editing = Boolean(taskId)
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedObject, setSelectedObject] = useState(objectId ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [objects, setObjects] = useState<Option[]>([])
  const [executors, setExecutors] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = editing ? 'Редактирование задачи — CRM' : 'Новая задача — CRM'
    let active = true

    void Promise.all([
      supabase.from('objects').select('id, name').order('name'),
      supabase.from('profiles').select('id, full_name').eq('role', 'executor').order('full_name'),
      taskId
        ? supabase
            .from('tasks')
            .select('title, description, object_id, assignee_id')
            .eq('id', taskId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]).then(([objectResult, executorResult, taskResult]) => {
      if (!active) return
      if (objectResult.error || executorResult.error || taskResult.error) {
        setError(
          errorText(
            objectResult.error ?? executorResult.error ?? taskResult.error,
            'Не удалось открыть форму',
          ),
        )
      }
      setObjects(objectResult.data ?? [])
      setExecutors(executorResult.data ?? [])
      if (taskResult.data) {
        setTitle(taskResult.data.title)
        setDescription(taskResult.data.description)
        setSelectedObject(taskResult.data.object_id)
        setAssigneeId(taskResult.data.assignee_id)
      } else if (!taskResult.data && taskId) {
        setError('Задача не найдена или нет доступа')
      }
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [editing, taskId])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {
      title: title.trim(),
      description: description.trim(),
      object_id: selectedObject,
      assignee_id: assigneeId,
    }

    if (!payload.object_id || !payload.assignee_id) {
      setError('Выберите объект и исполнителя')
      setSaving(false)
      return
    }

    if (editing && taskId) {
      const { data, error: updateError } = await supabase
        .from('tasks')
        .update(payload)
        .eq('id', taskId)
        .select('id')
      if (updateError || !data?.length) {
        setError(errorText(updateError, 'Не удалось сохранить задачу'))
        setSaving(false)
        return
      }
      navigate(`/tasks/${taskId}`)
      return
    }

    const { data, error: insertError } = await supabase.from('tasks').insert(payload).select('id').single()
    if (insertError || !data) {
      setError(errorText(insertError, 'Не удалось создать задачу'))
      setSaving(false)
      return
    }
    navigate(`/tasks/${data.id}`)
  }

  if (loading) return <p className="muted">Загрузка…</p>

  return (
    <section className="narrow">
      <Link className="back" to={taskId ? `/tasks/${taskId}` : selectedObject ? `/objects/${selectedObject}` : '/objects'}>
        Назад
      </Link>
      <h1>{editing ? 'Редактирование задачи' : 'Новая задача'}</h1>
      <p className="lede">Статус при создании всегда «Новая». Дальше его меняют только разрешённые переходы.</p>
      <form className="stack-form" onSubmit={(event) => void onSubmit(event)}>
        <label>
          Название
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
        </label>
        <label>
          Описание
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            maxLength={5000}
          />
        </label>
        <label>
          Объект
          <select value={selectedObject} onChange={(event) => setSelectedObject(event.target.value)} required>
            <option value="">Выберите объект</option>
            {objects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Исполнитель
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} required>
            <option value="">Выберите исполнителя</option>
            {executors.map((executor) => (
              <option key={executor.id} value={executor.id}>
                {executor.full_name}
              </option>
            ))}
          </select>
        </label>
        {executors.length === 0 && <p className="form-error">В базе нет исполнителей, задачу назначить некому.</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="button-row">
          <button type="submit" className="btn btn-primary" disabled={saving || executors.length === 0}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </section>
  )
}

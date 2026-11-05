import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { errorText } from '../lib/errors'
import { supabase } from '../lib/supabase'

export function ObjectFormPage() {
  const { objectId } = useParams()
  const editing = Boolean(objectId)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = editing ? 'Редактирование объекта — CRM' : 'Новый объект — CRM'
    if (!objectId) return
    let active = true
    void supabase
      .from('objects')
      .select('name, address')
      .eq('id', objectId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError || !data) {
          setError(errorText(queryError, 'Объект не найден или нет доступа'))
        } else {
          setName(data.name)
          setAddress(data.address)
        }
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [editing, objectId])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const payload = { name: name.trim(), address: address.trim() }

    if (editing && objectId) {
      const { data, error: updateError } = await supabase
        .from('objects')
        .update(payload)
        .eq('id', objectId)
        .select('id')
      if (updateError || !data?.length) {
        setError(errorText(updateError, 'Не удалось сохранить объект'))
        setSaving(false)
        return
      }
      navigate(`/objects/${objectId}`)
      return
    }

    const { data, error: insertError } = await supabase
      .from('objects')
      .insert(payload)
      .select('id')
      .single()
    if (insertError || !data) {
      setError(errorText(insertError, 'Не удалось создать объект'))
      setSaving(false)
      return
    }
    navigate(`/objects/${data.id}`)
  }

  if (loading) return <p className="muted">Загрузка…</p>

  return (
    <section className="narrow">
      <Link className="back" to={objectId ? `/objects/${objectId}` : '/objects'}>
        Назад
      </Link>
      <h1>{editing ? 'Редактирование объекта' : 'Новый объект'}</h1>
      <form className="stack-form" onSubmit={(event) => void onSubmit(event)}>
        <label>
          Название
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
        </label>
        <label>
          Адрес
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required
            maxLength={500}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="button-row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </section>
  )
}

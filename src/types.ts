export type UserRole = 'assigner' | 'executor'

export type TaskStatus = 'new' | 'in_progress' | 'in_review' | 'accepted' | 'rework'

export type Profile = {
  id: string
  email: string
  full_name: string
  role: UserRole
  created_at: string
}

export type SiteObject = {
  id: string
  name: string
  address: string
  created_by: string
  created_at: string
  updated_at: string
}

export type Person = {
  id: string
  full_name: string
}

export type ObjectRef = {
  id: string
  name: string
  address: string
}

export type HistoryEntry = {
  id: string
  from_status: TaskStatus | null
  to_status: TaskStatus
  comment: string | null
  created_at: string
  changed_by: string
  actor: Person | Person[] | null
}

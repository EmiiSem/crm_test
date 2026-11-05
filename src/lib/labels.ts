import type { TaskStatus, UserRole } from '../types'

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  in_review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
}

export const ROLE_LABEL: Record<UserRole, string> = {
  assigner: 'Постановщик',
  executor: 'Исполнитель',
}

export const STATUS_ORDER: TaskStatus[] = [
  'new',
  'in_progress',
  'in_review',
  'rework',
  'accepted',
]

export function actionLabel(from: TaskStatus, to: TaskStatus): string {
  if (to === 'in_progress' && from === 'new') return 'Взять в работу'
  if (to === 'in_progress' && from === 'rework') return 'Вернуть в работу'
  if (to === 'in_review') return 'Отправить на проверку'
  if (to === 'accepted') return 'Принять'
  if (to === 'rework') return 'Вернуть на доработку'
  return STATUS_LABEL[to]
}

export function availableActions(
  role: UserRole,
  status: TaskStatus,
  isAssignee: boolean,
): TaskStatus[] {
  if (role === 'executor' && isAssignee) {
    if (status === 'new' || status === 'rework') return ['in_progress']
    if (status === 'in_progress') return ['in_review']
  }
  if (role === 'assigner' && status === 'in_review') return ['accepted', 'rework']
  return []
}

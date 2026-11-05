const KNOWN: Record<string, string> = {
  NOT_AUTHENTICATED: 'Нужно войти в систему',
  TASK_NOT_FOUND: 'Задача не найдена или нет доступа',
  OBJECT_NOT_FOUND: 'Объект не найден или нет доступа',
  FORBIDDEN: 'Это действие вам недоступно',
  FORBIDDEN_TRANSITION: 'Такой переход статуса запрещён',
  COMMENT_REQUIRED: 'При возврате на доработку нужен комментарий',
  COMMENT_TOO_LONG: 'Комментарий длиннее 2000 символов',
  ASSIGNEE_MUST_BE_EXECUTOR: 'Исполнителем можно назначить только исполнителя',
  ONLY_ASSIGNER: 'Это может сделать только постановщик',
  HISTORY_IMMUTABLE: 'Историю статусов нельзя изменить',
}

type QueryError = {
  message?: string
  code?: string
} | null

export function errorText(error: QueryError, fallback = 'Не удалось выполнить действие'): string {
  if (!error) return fallback
  const message = error.message ?? ''
  for (const [code, text] of Object.entries(KNOWN)) {
    if (message.includes(code)) return text
  }
  if (error.code === '23514') return 'Проверьте заполнение полей'
  if (error.code === '23503') return 'Связанная запись не найдена'
  if (error.code === '42501') return 'Недостаточно прав для этого действия'
  return fallback
}

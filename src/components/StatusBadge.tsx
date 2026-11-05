import { STATUS_LABEL } from '../lib/labels'
import type { TaskStatus } from '../types'

export function StatusBadge({ status, count }: { status: TaskStatus; count?: number }) {
  return (
    <span className={`badge badge-${status}`}>
      {STATUS_LABEL[status]}
      {count !== undefined && <span className="badge-count">{count}</span>}
    </span>
  )
}

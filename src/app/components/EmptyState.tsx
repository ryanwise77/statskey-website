import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  subtitle?: string
  children?: ReactNode
}

export function EmptyState({ title, subtitle, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="title">{title}</span>
      {subtitle && <span>{subtitle}</span>}
      {children}
    </div>
  )
}

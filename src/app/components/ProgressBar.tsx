interface ProgressBarProps {
  value: number
  target: number
  variant?: 'accent' | 'teal'
}

export function ProgressBar({ value, target, variant = 'accent' }: ProgressBarProps) {
  const clampedTarget = target > 0 ? target : 1
  const pct = Math.min(100, Math.max(0, (value / clampedTarget) * 100))
  const over = value > target
  const classes = ['progress-fill']
  if (variant === 'teal') classes.push('teal')
  if (over) classes.push('over')
  return (
    <div className="progress">
      <div className={classes.join(' ')} style={{ width: `${pct}%` }} />
    </div>
  )
}

interface ProgressRowProps {
  label: string
  value: number
  target: number
  unit?: string
  variant?: 'accent' | 'teal'
}

export function ProgressRow({ label, value, target, unit = 'g', variant = 'accent' }: ProgressRowProps) {
  return (
    <div className="space-y-1.5">
      <div className="progress-row">
        <span className="label">{label}</span>
        <ProgressBar value={value} target={target} variant={variant} />
        <span className="value">
          {Math.round(value)}
          <span className="text-text-muted"> / {Math.round(target)}{unit}</span>
        </span>
      </div>
    </div>
  )
}

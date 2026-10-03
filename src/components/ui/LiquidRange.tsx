import type { CSSProperties, InputHTMLAttributes } from 'react'

interface LiquidRangeProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'> {
  label: string
  min?: number
  max?: number
  value: number
  onValueChange: (value: number) => void
}

/** Native range input with a theme-aware glass thumb and full keyboard support. */
export default function LiquidRange({ label, min = 0, max = 100, value, onValueChange, className = '', ...props }: LiquidRangeProps) {
  const progress = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0
  return (
    <input
      {...props}
      type="range"
      aria-label={label}
      min={min}
      max={max}
      value={value}
      onChange={event => onValueChange(Number(event.currentTarget.value))}
      className={`liquid-range ${className}`.trim()}
      style={{ ...props.style, '--range-progress': `${progress}%` } as CSSProperties}
    />
  )
}

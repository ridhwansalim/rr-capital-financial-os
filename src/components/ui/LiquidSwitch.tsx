import type { ButtonHTMLAttributes } from 'react'

interface LiquidSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}

/** Theme-aware, keyboard-accessible glass switch for boolean preferences. */
export default function LiquidSwitch({ checked, label, onCheckedChange, className = '', ...props }: LiquidSwitchProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      className={`liquid-switch ${className}`.trim()}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="liquid-switch__thumb" aria-hidden="true" />
    </button>
  )
}

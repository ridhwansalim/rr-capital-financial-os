export function liquidGlassItemProps(key: string, active: boolean, className = '') {
  return {
    'data-glass-key': key,
    className: `liquid-switcher__item ${active ? 'is-active' : ''} ${className}`.trim(),
  }
}

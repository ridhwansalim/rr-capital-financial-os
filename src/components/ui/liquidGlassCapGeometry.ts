/** Expand a switcher's active cap while keeping it inside the track edges. */
export function getExpandedCapBounds(trackWidth: number, targetX: number, targetWidth: number) {
  const edgeInset = 2
  const expansion = 5
  const maxWidth = Math.max(0, trackWidth - edgeInset * 2)
  const width = Math.min(targetWidth + expansion * 2, maxWidth)
  const maxX = Math.max(edgeInset, trackWidth - edgeInset - width)
  const x = Math.min(maxX, Math.max(edgeInset, targetX - expansion))

  return { x, width }
}

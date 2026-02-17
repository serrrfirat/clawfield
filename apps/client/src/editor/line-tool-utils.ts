/**
 * Computes evenly spaced positions along a line from start to end.
 * Each position includes a Y rotation that aligns the object to the line direction.
 */
export interface LineGhost {
  position: [number, number, number]
  rotationY: number
}

export function computeLineGhosts(
  start: [number, number, number],
  end: [number, number, number],
  spacing: number,
  alignRotation: boolean,
  baseRotation: number,
): LineGhost[] {
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const length = Math.sqrt(dx * dx + dz * dz)

  if (length < 0.01 || spacing < 0.01) return []

  // Line direction angle — atan2(dx, dz) gives yaw where +Z is forward
  const dirAngle = Math.atan2(dx, dz)
  const rotY = alignRotation ? dirAngle + baseRotation : baseRotation

  const count = Math.max(1, Math.floor(length / spacing)) + 1
  const ghosts: LineGhost[] = []

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    const x = start[0] + dx * t
    const y = (start[1] + end[1]) * 0.5 // average Y for now — terrain sampling happens at commit
    const z = start[2] + dz * t
    ghosts.push({ position: [x, y, z], rotationY: rotY })
  }

  return ghosts
}

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import usePhases, { PHASES } from '../stores/usePhases'
import useStore from '../stores/useStore'
import './GameHud.css'
import { createTerrainHeight } from '@clawfield/shared'
import { useNetwork } from '../network/NetworkProvider'
import { LOS_MEMORY_MS, isTargetVisibleToLocal } from '../player/visibility'

const ORDER_TEXT = [
    'New attack orders, secure the lane from west.',
    'Advance and hold objective line.',
    'Push forward, keep pressure on target zone.',
]

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value))
}

function clampPercent(value: number) {
    return Math.max(0, Math.min(100, value))
}

function mapPercentToWorld(positionPct: { xPct: number; yPct: number }, bounds: any) {
    const spanX = Math.max(1, bounds.maxX - bounds.minX)
    const spanZ = Math.max(1, bounds.maxZ - bounds.minZ)
    return {
        x: bounds.minX + (clampPercent(positionPct.xPct) / 100) * spanX,
        y: 0,
        z: bounds.minZ + (clampPercent(positionPct.yPct) / 100) * spanZ,
    }
}

function markerPercent(value: number) {
    return clampPercent(value)
}

function teamMarkerColor(team: number) {
    if (team === 0) return '#56a5ff'
    if (team === 1) return '#e06b66'
    return '#b1a68b'
}

function terrainColor(height: number) {
    if (height < -1.4) return '#5c6672'
    if (height < -0.8) return '#5f6d5d'
    if (height < -0.1) return '#66824d'
    if (height < 0.45) return '#5f8449'
    if (height < 1.1) return '#75975c'
    return '#86ad63'
}

function terrainYAt(matchConfig: any, x: number, z: number) {
    if (!matchConfig?.terrain) return 0
    const terrain = createTerrainHeight(matchConfig.terrain.scale, matchConfig.terrain.amplitude, matchConfig.seed ?? 0, matchConfig.heightmap)
    return terrain(x, z)
}

export default function GameHud() {
  const phase = usePhases((s: any) => s.phase)
    const ammo = useStore((s: any) => s.ammo)
    const maxAmmo = useStore((s: any) => s.maxAmmo)
    const weaponName = useStore((s: any) => s.weaponName)
    const gameMode = useStore((s: any) => s.gameMode)
  const suppression = useStore((s: any) => s.suppression ?? 0)
      const flash = useStore((s: any) => s.flash ?? 0)
      const alive = useStore((s: any) => Boolean(s.alive))
    const downed = useStore((s: any) => Boolean(s.downed))
    const respawnEndsAt = useStore((s: any) => Number(s.respawnEndsAt ?? 0))
    const localAimYaw = useStore((s: any) => Number(s.localAimYaw ?? 0))
    const localScreenPos = useStore((s: any) => s.localScreenPos ?? { xPct: 50, yPct: 60 })
    const selectedGrenadeIndex = useStore((s: any) => s.selectedGrenadeIndex ?? 0)
    const myTeam = useStore((s: any) => s.myTeam)
    const capturePoints = useStore((s: any) => s.capturePoints)
    const availableSpawns = useStore((s: any) => s.availableSpawns ?? [])
    const squadTargets = useStore((s: any) => s.squadTargets ?? [])
    const ticketsAlpha = useStore((s: any) => s.ticketsAlpha)
    const ticketsBravo = useStore((s: any) => s.ticketsBravo)
    const conquestScoreAlpha = useStore((s: any) => s.conquestScoreAlpha)
    const conquestScoreBravo = useStore((s: any) => s.conquestScoreBravo)
    const matchConfig = useStore((s: any) => s.matchConfig)
    const ballPosition = useStore((s: any) => s.ballPosition)
  const remotePlayers = useStore((s: any) => s.remotePlayers)
  const obstacleDiscs = useStore((s: any) => s.obstacleDiscs ?? [])
  const myId = useStore((s: any) => s.myId)
  const myTeamNumber = Number(myTeam ?? -1)
  const [mapOpen, setMapOpen] = useState(false)
    const [nowMs, setNowMs] = useState(() => Date.now())
  const mapBoardRef = useRef<HTMLDivElement | null>(null)
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const network = useNetwork()
  const enemyMemoryUntilRef = useRef(new Map<string, number>())
  const setMapOpenGlobal = useStore((s: any) => s.setMapOpen)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyM') return
      if (event.repeat) return
      setMapOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    setMapOpenGlobal?.(mapOpen)
    return () => setMapOpenGlobal?.(false)
  }, [mapOpen, setMapOpenGlobal])

  useEffect(() => {
    const shouldTick = mapOpen || (!alive && !downed && respawnEndsAt > 0)
    if (!shouldTick) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [alive, downed, respawnEndsAt, mapOpen])

  const handleMapBoardMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!mapOpen || !network || !matchConfig?.bounds) return
    const rect = mapBoardRef.current?.getBoundingClientRect()
    if (!rect) return
    const xPct = markerPercent(((event.clientX - rect.left) / rect.width) * 100)
    const yPct = markerPercent(((event.clientY - rect.top) / rect.height) * 100)
    if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) return

    const worldPosition = mapPercentToWorld({ xPct, yPct }, matchConfig.bounds)
    network.send({
      type: 'ping',
      position: worldPosition,
      label: 'PING',
      ttlSeconds: 10,
    })
  }

  useEffect(() => {
    const bounds = matchConfig?.bounds ?? {
      minX: -150,
      maxX: 150,
      minZ: -150,
      maxZ: 150,
    }
    const board = mapBoardRef.current
    const canvas = mapCanvasRef.current
    if (!mapOpen || !board || !canvas) return

    const rect = board.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return

    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = '#bcc4ac'
    ctx.fillRect(0, 0, rect.width, rect.height)

    const boundsSpanX = Math.max(1, bounds.maxX - bounds.minX)
    const boundsSpanZ = Math.max(1, bounds.maxZ - bounds.minZ)
    const hasTerrain = Boolean(matchConfig?.terrain)
    const cols = Math.max(56, Math.min(220, Math.round(rect.width / 4)))
    const rows = cols
    const cellW = rect.width / Math.max(1, cols - 1)
    const cellH = rect.height / Math.max(1, rows - 1)

    if (hasTerrain) {
      for (let row = 0; row < rows; row++) {
        const worldZ = bounds.minZ + (row / (rows - 1 || 1)) * boundsSpanZ
        const top = row * cellH
        for (let col = 0; col < cols; col++) {
          const worldX = bounds.minX + (col / (cols - 1 || 1)) * boundsSpanX
          const h = terrainYAt(matchConfig, worldX, worldZ)
          ctx.fillStyle = terrainColor(h)
          ctx.fillRect(col * cellW, top, cellW + 0.6, cellH + 0.6)
        }
      }
    } else {
      const grad = ctx.createLinearGradient(0, 0, rect.width, rect.height)
      grad.addColorStop(0, '#b8beae')
      grad.addColorStop(1, '#ccd7bc')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, rect.width, rect.height)
    }

    if (obstacleDiscs.length > 0) {
      const scaleX = rect.width / boundsSpanX
      const scaleZ = rect.height / boundsSpanZ
      for (const disc of obstacleDiscs) {
        if (!disc || !Number.isFinite(Number(disc.x)) || !Number.isFinite(Number(disc.z)) || !Number.isFinite(Number(disc.r))) {
          continue
        }

        const cx = (Number(disc.x) - bounds.minX) * scaleX
        const cy = (Number(disc.z) - bounds.minZ) * scaleZ
        const radius = Math.max(1, Number(disc.r) * Math.min(scaleX, scaleZ))

        ctx.beginPath()
        ctx.fillStyle = 'rgba(49, 49, 46, 0.62)'
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const majorLineEvery = Math.max(1, Math.floor(cols / 10))
    ctx.strokeStyle = 'rgba(22, 22, 22, 0.24)'
    ctx.lineWidth = 1
    for (let i = 1; i < 10; i++) {
      const x = (rect.width * i) / 10
      const y = (rect.height * i) / 10
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rect.height)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()
    }
    if (majorLineEvery > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
      ctx.setLineDash([2, 4])
      for (let i = 0; i <= rows; i += majorLineEvery) {
        const y = (i / Math.max(1, rows)) * rect.height
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(rect.width, y)
        ctx.stroke()
      }
      for (let i = 0; i <= cols; i += majorLineEvery) {
        const x = (i / Math.max(1, cols)) * rect.width
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, rect.height)
        ctx.stroke()
      }
      ctx.setLineDash([])
    }
  }, [mapOpen, matchConfig?.bounds?.minX, matchConfig?.bounds?.maxX, matchConfig?.bounds?.minZ, matchConfig?.bounds?.maxZ, matchConfig?.terrain?.scale, matchConfig?.terrain?.amplitude, matchConfig?.seed, matchConfig?.heightmap?.cellSize, matchConfig?.heightmap?.cells?.length, obstacleDiscs.length])

    const objectiveLabel = capturePoints?.length
        ? String(capturePoints[0].id ?? '').trim().toUpperCase() || 'OBJECTIVE'
        : 'DOCKS'

  const objectiveCountText = capturePoints?.length
        ? `${capturePoints.filter((cp: any) => cp.owner === myTeamNumber).length} / ${capturePoints.length}`
        : '0 / 0'

  const flashOverlayOpacity = clamp01(Number(flash) * 0.62)

    const scoreAlpha = gameMode === 'tdm' ? Number(ticketsAlpha) : Number(conquestScoreAlpha)
    const scoreBravo = gameMode === 'tdm' ? Number(ticketsBravo) : Number(conquestScoreBravo)
    const scoreTotal = Math.max(1, scoreAlpha + scoreBravo)
    const alphaShare = clamp01(scoreAlpha / scoreTotal)

    let winnerText = 'TIED'
    if (scoreAlpha > scoreBravo) winnerText = 'ALPHA LEADING'
    if (scoreBravo > scoreAlpha) winnerText = 'BRAVO LEADING'

  const modeLabel = gameMode === 'tdm'
        ? 'TDM TICKETS'
        : gameMode === 'conquest'
            ? 'CONQUEST SCORE'
            : 'INCURSION SCORE'

  const grenadeLabel = selectedGrenadeIndex === 1 ? 'SMOKE' : selectedGrenadeIndex === 2 ? 'FLASH' : 'FRAG'
  const rearVisionAngle = `${((((localAimYaw * 180) / Math.PI) + 180) % 360 + 360) % 360}deg`
  const backOffset = 6
  const rearCx = Math.max(0, Math.min(100, Number(localScreenPos.xPct ?? 50) - Math.sin(localAimYaw) * backOffset))
  const rearCy = Math.max(0, Math.min(100, Number(localScreenPos.yPct ?? 60) + Math.cos(localAimYaw) * backOffset))

  if (phase !== PHASES.start) return null

  const bounds = matchConfig?.bounds ?? {
    minX: -150,
    maxX: 150,
    minZ: -150,
    maxZ: 150,
  }
  const spanX = Math.max(1, bounds.maxX - bounds.minX)
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ)

  const localMapPos = {
    xPct: ((Number(ballPosition?.x ?? 0) - bounds.minX) / spanX) * 100,
    yPct: ((Number(ballPosition?.z ?? 0) - bounds.minZ) / spanZ) * 100,
  }

  const remoteMarkers: any[] = []
  const localPos = {
    x: Number(ballPosition?.x ?? 0),
    z: Number(ballPosition?.z ?? 0),
  }
  const now = nowMs

  enemyMemoryUntilRef.current.forEach((expiresAt, id) => {
    if (expiresAt <= now) enemyMemoryUntilRef.current.delete(id)
  })

  if (remotePlayers && typeof remotePlayers.forEach === 'function') {
      remotePlayers.forEach((p: any, id: string) => {
        if (!p?.alive || id === myId) return

        const isEnemy = Number(p.team ?? -1) !== myTeamNumber
      if (isEnemy) {
        const isVisible = isTargetVisibleToLocal(
          localPos,
          localAimYaw,
          { x: Number(p.position?.x ?? 0), z: Number(p.position?.z ?? 0) },
          obstacleDiscs,
        )

        if (isVisible) {
          enemyMemoryUntilRef.current.set(id, now + LOS_MEMORY_MS)
        }

        const seenUntil = enemyMemoryUntilRef.current.get(id) ?? 0
        if (!isVisible && now > seenUntil) return
      }

      remoteMarkers.push({
        id,
        team: Number(p.team ?? -1),
        xPct: ((Number(p.position?.x ?? 0) - bounds.minX) / spanX) * 100,
        yPct: ((Number(p.position?.z ?? 0) - bounds.minZ) / spanZ) * 100,
      })
    })
  }

  const captureMarkers = (capturePoints ?? []).map((cp: any) => ({
    id: String(cp.id ?? '?'),
    owner: Number(cp.owner ?? -1),
    contested: Boolean(cp.contested),
    xPct: ((Number(cp.position?.x ?? 0) - bounds.minX) / spanX) * 100,
    yPct: ((Number(cp.position?.z ?? 0) - bounds.minZ) / spanZ) * 100,
  }))

  const spawnMarkers = (availableSpawns ?? []).map((sp: any) => ({
    id: String(sp.id ?? ''),
    name: String(sp.name ?? '').trim(),
    type: String(sp.type ?? ''),
    xPct: ((Number(sp.position?.x ?? 0) - bounds.minX) / spanX) * 100,
    yPct: ((Number(sp.position?.z ?? 0) - bounds.minZ) / spanZ) * 100,
  }))

  const squadTargetMarkers = (squadTargets ?? [])
    .map((target: any) => {
      const team = Number(target.team ?? target.sourceTeam ?? -1)
      return {
        id: String(target.id ?? `squad-${Math.random()}`),
        label: String(target.label ?? 'PING'),
        xPct: ((Number(target.position?.x ?? 0) - bounds.minX) / spanX) * 100,
        yPct: ((Number(target.position?.z ?? 0) - bounds.minZ) / spanZ) * 100,
        color: teamMarkerColor(team),
      }
    })
    .filter((m: any) => Number.isFinite(m.xPct) && Number.isFinite(m.yPct))

  const myTeamIndex = Number.isFinite(myTeamNumber) && myTeamNumber >= 0 ? myTeamNumber : 0
  const orderText = ORDER_TEXT[myTeamIndex % ORDER_TEXT.length]
  const respawnRemaining = !alive && !downed && respawnEndsAt > 0
    ? Math.max(0, (respawnEndsAt - nowMs) / 1000)
    : 0

    return (
        <div className="game-hud" style={{ pointerEvents: mapOpen ? 'auto' : 'none' }}>
            <div
              className="game-hud__rear-vision"
              style={{
                ['--rear-vision-angle' as any]: rearVisionAngle,
                ['--rear-vision-cx' as any]: `${rearCx}%`,
                ['--rear-vision-cy' as any]: `${rearCy}%`,
              }}
              aria-hidden
            />
            <div className="game-hud__orders" aria-label="Current order">
                <span className="game-hud__orders-avatar" />
                <span className="game-hud__orders-text">{orderText}</span>
            </div>

            <div className="game-hud__bottom-left" aria-label="Weapon and ammo">
                <div className="game-hud__weapon-stack">
                    <span className="game-hud__weapon-silhouette" />
                    <span className="game-hud__gear-icon">G</span>
                    <span className="game-hud__gear-icon">M</span>
                </div>
                <div className="game-hud__ammo-stack">
                    <div className="game-hud__ammo-main">{ammo}/{maxAmmo}</div>
                    <div className="game-hud__ammo-sub">{weaponName.toUpperCase()}  -  {grenadeLabel}</div>
                </div>
            </div>

            <div className="game-hud__objective" aria-label="Match lead and progress">
                <span className="game-hud__objective-label">{objectiveLabel}</span>
                <div className="game-hud__objective-track">
                    <span className="game-hud__objective-half game-hud__objective-half--alpha" />
                    <span className="game-hud__objective-half game-hud__objective-half--bravo" />
                    <span className="game-hud__objective-divider" style={{ left: `${alphaShare * 100}%` }} />
                </div>
                <span className="game-hud__score game-hud__score--alpha">{scoreAlpha}</span>
                <span className="game-hud__score game-hud__score--bravo">{scoreBravo}</span>
            </div>

      <div className="game-hud__bottom-right" aria-label="Objective count">
        <span>{modeLabel}</span>
        <span>{winnerText}</span>
        <span>{objectiveCountText}</span>
        {suppression > 0.05 && <span className="game-hud__warning">SUPPRESSED</span>}
        <span className="game-hud__map-hint">M: Tactical Map</span>
      </div>

        {flashOverlayOpacity > 0.01 && (
          <div className="game-hud__flash" style={{ opacity: Math.min(0.96, flashOverlayOpacity) }} aria-hidden />
        )}

      {respawnRemaining > 0 && (
        <div className="game-hud__respawn" aria-label="Respawn timer">
          Respawning In {respawnRemaining.toFixed(1)}
        </div>
      )}

      {mapOpen && (
        <div className="game-hud__map-overlay" aria-label="Tactical map view">
          <div className="game-hud__map-sheet">
            <div className="game-hud__map-title">Clawfield Tactical Map</div>
            <div
              className="game-hud__map-board"
              ref={mapBoardRef}
              onMouseDown={handleMapBoardMouseDown}
              role="application"
              aria-label="Tactical map"
            >
              <canvas ref={mapCanvasRef} className="game-hud__map-canvas" />
              <div className="game-hud__map-grid" />

              {captureMarkers.map((cp: any) => (
                <div
                  key={`cp-${cp.id}`}
                  className={`game-hud__map-cp ${cp.contested ? 'is-contested' : ''}`}
                  style={{
                    left: `${markerPercent(cp.xPct)}%`,
                    top: `${markerPercent(cp.yPct)}%`,
                    borderColor: cp.owner === 0 ? '#2f78cf' : cp.owner === 1 ? '#c74242' : '#a89f8c',
                  }}
                  title={`Point ${cp.id}`}
                >
                  {cp.id}
                </div>
              ))}

              {spawnMarkers.map((sp: any) => (
                <span
                  key={`spawn-${sp.id}`}
                  className="game-hud__map-spawn"
                  style={{
                    left: `${markerPercent(sp.xPct)}%`,
                    top: `${markerPercent(sp.yPct)}%`,
                    background: sp.type === 'base' ? '#6f6a5a' : '#a57f49',
                  }}
                  title={sp.name || `Spawn ${sp.id}`}
                />
              ))}

              {squadTargetMarkers.map((st: any) => (
                <span
                  key={`target-${st.id}`}
                  className="game-hud__map-ping"
                  style={{
                    left: `${markerPercent(st.xPct)}%`,
                    top: `${markerPercent(st.yPct)}%`,
                    background: st.color,
                  }}
                  title={st.label}
                />
              ))}

              {remoteMarkers.map((p: any) => (
                <span
                  key={`rp-${p.id}`}
                  className="game-hud__map-player"
                  style={{
                    left: `${markerPercent(p.xPct)}%`,
                    top: `${markerPercent(p.yPct)}%`,
                    background: p.team === myTeamNumber ? '#50b475' : '#d06b63',
                  }}
                />
              ))}

              <span
                className="game-hud__map-player game-hud__map-player--self"
                style={{
                  left: `${markerPercent(localMapPos.xPct)}%`,
                  top: `${markerPercent(localMapPos.yPct)}%`,
                }}
                title="You"
              />
            </div>
            <div className="game-hud__map-legend">
              <span><i className="self" /> You</span>
              <span><i className="ally" /> Ally</span>
              <span><i className="enemy" /> Enemy</span>
              <span><i className="cp" /> Capture point</span>
              <span><i className="spawn" /> Spawn</span>
              <span><i className="ping" /> Squad ping</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import usePhases, { PHASES } from '../stores/usePhases'
import useStore from '../stores/useStore'
import './GameHud.css'

const ORDER_TEXT = [
    'New attack orders, secure the lane from west.',
    'Advance and hold objective line.',
    'Push forward, keep pressure on target zone.',
]

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value))
}

export default function GameHud() {
  const phase = usePhases((s: any) => s.phase)
    const ammo = useStore((s: any) => s.ammo)
    const maxAmmo = useStore((s: any) => s.maxAmmo)
    const weaponName = useStore((s: any) => s.weaponName)
    const gameMode = useStore((s: any) => s.gameMode)
    const suppression = useStore((s: any) => s.suppression ?? 0)
    const flash = useStore((s: any) => s.flash ?? 0)
    const selectedGrenadeIndex = useStore((s: any) => s.selectedGrenadeIndex ?? 0)
    const myTeam = useStore((s: any) => s.myTeam)
    const capturePoints = useStore((s: any) => s.capturePoints)
    const ticketsAlpha = useStore((s: any) => s.ticketsAlpha)
    const ticketsBravo = useStore((s: any) => s.ticketsBravo)
  const conquestScoreAlpha = useStore((s: any) => s.conquestScoreAlpha)
  const conquestScoreBravo = useStore((s: any) => s.conquestScoreBravo)
  const matchConfig = useStore((s: any) => s.matchConfig)
  const ballPosition = useStore((s: any) => s.ballPosition)
  const remotePlayers = useStore((s: any) => s.remotePlayers)
  const myId = useStore((s: any) => s.myId)
  const [mapOpen, setMapOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyM') return
      if (event.repeat) return
      setMapOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

    const objectiveLabel = capturePoints?.length
        ? String(capturePoints[0].id ?? '').trim().toUpperCase() || 'OBJECTIVE'
        : 'DOCKS'

    const objectiveCountText = capturePoints?.length
        ? `${capturePoints.filter((cp: any) => cp.owner === myTeam).length} / ${capturePoints.length}`
        : '0 / 0'

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
  if (remotePlayers && typeof remotePlayers.forEach === 'function') {
    remotePlayers.forEach((p: any, id: string) => {
      if (!p?.alive || id === myId) return
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

  const orderText = ORDER_TEXT[myTeam % ORDER_TEXT.length]

    return (
        <div className="game-hud">
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

      {flash > 0.01 && (
        <div className="game-hud__flash" style={{ opacity: Math.min(0.85, flash * 0.9) }} aria-hidden />
      )}

      {mapOpen && (
        <div className="game-hud__map-overlay" aria-label="Tactical map view">
          <div className="game-hud__map-sheet">
            <div className="game-hud__map-title">Clawfield Tactical Map</div>
            <div className="game-hud__map-board">
              <div className="game-hud__map-grid" />

              {captureMarkers.map((cp: any) => (
                <div
                  key={`cp-${cp.id}`}
                  className={`game-hud__map-cp ${cp.contested ? 'is-contested' : ''}`}
                  style={{
                    left: `${cp.xPct}%`,
                    top: `${cp.yPct}%`,
                    borderColor: cp.owner === 0 ? '#2f78cf' : cp.owner === 1 ? '#c74242' : '#a89f8c',
                  }}
                  title={`Point ${cp.id}`}
                >
                  {cp.id}
                </div>
              ))}

              {remoteMarkers.map((p: any) => (
                <span
                  key={`rp-${p.id}`}
                  className="game-hud__map-player"
                  style={{
                    left: `${p.xPct}%`,
                    top: `${p.yPct}%`,
                    background: p.team === myTeam ? '#50b475' : '#d06b63',
                  }}
                />
              ))}

              <span
                className="game-hud__map-player game-hud__map-player--self"
                style={{ left: `${localMapPos.xPct}%`, top: `${localMapPos.yPct}%` }}
              />
            </div>
            <div className="game-hud__map-legend">
              <span><i className="self" /> You</span>
              <span><i className="ally" /> Ally</span>
              <span><i className="enemy" /> Enemy</span>
              <span><i className="cp" /> Capture point</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

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
    const myTeam = useStore((s: any) => s.myTeam)
    const capturePoints = useStore((s: any) => s.capturePoints)
    const ticketsAlpha = useStore((s: any) => s.ticketsAlpha)
    const ticketsBravo = useStore((s: any) => s.ticketsBravo)
    const conquestScoreAlpha = useStore((s: any) => s.conquestScoreAlpha)
    const conquestScoreBravo = useStore((s: any) => s.conquestScoreBravo)

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

    if (phase !== PHASES.start) return null

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
                    <div className="game-hud__ammo-sub">{weaponName.toUpperCase()}</div>
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
            </div>
        </div>
    )
}

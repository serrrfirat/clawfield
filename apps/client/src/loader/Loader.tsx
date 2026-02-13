import { useProgress } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'

import usePhases, { PHASES } from '../stores/usePhases'
import useStore from '../stores/useStore'
import type { MapdefJson } from '../editor/editor-types'
import { buildPlacementColliders } from '@clawfield/shared'
import { useNetwork } from '../network/NetworkProvider'
import './loader.css'

const RING_COLOR = '#ffffff'
const RING_TRACK_COLOR = 'rgba(0, 0, 0, 0.1)'

export default function Loader() {
    const { active, progress } = useProgress()
    const phase = usePhases((s: any) => s.phase)
    const setPhase = usePhases((s: any) => s.setPhase)
    const setMapPlacements = useStore((s) => s.setMapPlacements)
    const connected = useStore((s: any) => s.connected)
    const myId = useStore((s: any) => s.myId)
    const lobbyPlayers = useStore((s: any) => s.lobbyPlayers)
    const lobbyHostId = useStore((s: any) => s.lobbyHostId)
    const lobbyRoomCode = useStore((s: any) => s.lobbyRoomCode)
    const lobbyPhase = useStore((s: any) => s.lobbyPhase)
    const lobbyError = useStore((s: any) => s.lobbyError)
    const lobbySeed = useStore((s: any) => s.lobbySeed)
    const gameMode = useStore((s: any) => s.gameMode)
    const mapPlacements = useStore((s: any) => s.mapPlacements)

    const network = useNetwork()
    const [playerName, setPlayerName] = useState('Player')
    const [roomCodeInput, setRoomCodeInput] = useState('')
    const [seedInput, setSeedInput] = useState('1337')

    const [displayed, setDisplayed] = useState(0)

    const lastPctRef = useRef(0)
    const displayedRef = useRef({ value: 0 })

    // Calculate target progress
    const target = useMemo(() => {
        const clamped = Math.min(100, Math.max(0, progress))
        return active ? Math.max(1, clamped) : clamped
    }, [active, progress])

    // Animate displayed value toward target using GSAP
    useEffect(() => {
        displayedRef.current.value = displayed

        const animation = gsap.to(displayedRef.current, {
            value: target,
            duration: 0.3,
            ease: 'power1.out',
            onUpdate: () => {
                setDisplayed(displayedRef.current.value)
            },
        })

        return () => {
            animation.kill()
        }
    }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

    // Calculate percent (monotonic, never decreases)
    const percent = useMemo(() => {
        const raw = Math.round(Math.max(0, Math.min(100, displayed)))
        if (raw < lastPctRef.current) return lastPctRef.current
        lastPctRef.current = raw
        return raw
    }, [displayed])

    // Transition from loading to warmup when complete
    useEffect(() => {
        if (phase === PHASES.loading && !active && percent >= 100) {
            setPhase(PHASES.warmup)
        }
    }, [phase, active, percent, setPhase])

    useEffect(() => {
        if (phase === PHASES.warmup && connected && lobbyPhase === 'in_game') {
            setPhase(PHASES.start)
        }
    }, [phase, connected, lobbyPhase, setPhase])

    useEffect(() => {
        if (lobbySeed) {
            setSeedInput(String(lobbySeed))
        }
    }, [lobbySeed])

    const handleQuickPlay = () => {
        if (phase !== PHASES.warmup) return
        network?.join(playerName || 'Player', 'tdm')
    }

    const handleCreateRoom = async () => {
        if (phase !== PHASES.warmup) return
        if (network?.createRoom) {
            await network.createRoom(playerName || 'Player', 'tdm')
        } else {
            network?.join(playerName || 'Player', 'tdm')
        }
    }

    const handleJoinRoom = async () => {
        if (phase !== PHASES.warmup) return
        const code = roomCodeInput.trim().toUpperCase()
        if (!code) return
        if (network?.joinRoom) {
            await network.joinRoom(playerName || 'Player', code)
        } else {
            network?.join(playerName || 'Player', 'tdm')
        }
    }

    const handleStartGame = () => {
        if (network?.setLobbyPlacementColliders) {
            const colliders = buildPlacementColliders(mapPlacements ?? [])
            network.setLobbyPlacementColliders(colliders)
        }
        network?.startGame?.()
    }

    const handleSetTeam = (team: number) => {
        network?.setLobbyTeam?.(team)
    }

    const handleSetMode = (value: string) => {
        network?.setLobbyMode?.(value as any)
    }

    const handleSetSeed = () => {
        const parsed = Number(seedInput)
        if (Number.isFinite(parsed) && parsed > 0) {
            network?.setLobbySeed?.(Math.floor(parsed))
        }
    }

    const handleLoadMap = useCallback(() => {
        if (phase !== PHASES.warmup) return

        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,.mapdef.json'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            try {
                const text = await file.text()
                const mapdef: MapdefJson = JSON.parse(text)
                if (mapdef.placements?.length) {
                    setMapPlacements(mapdef.placements)
                }
                setPhase(PHASES.start)
            } catch (err) {
                console.error('Failed to load mapdef:', err)
            }
        }
        input.click()
    }, [phase, setMapPlacements, setPhase])

    const handleOpenEditor = () => {
        window.location.href = window.location.pathname + '?mode=editor'
    }

    const handleOpenViewer = () => {
        window.location.href = 'viewer.html'
    }

    const showLoading = phase === PHASES.loading
    const showStart = phase === PHASES.warmup
    const inLobby = showStart && lobbyPhase === 'lobby' && lobbyRoomCode
    const isHost = !!myId && myId === lobbyHostId

    if (!showLoading && !showStart) return null

    const ringStyle = {
        background: `conic-gradient(from -90deg, ${RING_COLOR} ${percent * 3.6}deg, ${RING_TRACK_COLOR} ${percent * 3.6}deg)`,
    }

    return (
        <div className="loader-wrapper">
            <div className="loader-container">
                <div className="loader-ring" style={ringStyle}>
                    <div className="loader-ring-inner" />
                </div>
                <div className="loader-center">
                    {showLoading && <div className="loader-percent">{percent}%</div>}
                </div>
                {showStart && (
                    <div className="loader-buttons">
                        <input
                            className="loader-input"
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            placeholder="PLAYER NAME"
                            maxLength={20}
                        />

                        {!inLobby && (
                            <>
                                <button className="loader-btn" onClick={handleQuickPlay}>
                                    QUICK PLAY
                                </button>
                                <button className="loader-btn" onClick={handleCreateRoom}>
                                    CREATE ROOM
                                </button>
                                <div className="loader-room-row">
                                    <input
                                        className="loader-input loader-input-code"
                                        value={roomCodeInput}
                                        onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                                        placeholder="ROOM CODE"
                                        maxLength={6}
                                    />
                                    <button className="loader-btn loader-btn-compact" onClick={handleJoinRoom}>
                                        JOIN
                                    </button>
                                </div>
                            </>
                        )}

                        {inLobby && (
                            <>
                                <div className="loader-lobby-meta">ROOM {lobbyRoomCode}</div>
                                <div className="loader-lobby-list">
                                    {lobbyPlayers.map((p: any) => (
                                        <div key={p.id} className="loader-lobby-item">
                                            <span>{p.name}</span>
                                            <span>{p.team === 0 ? 'ALPHA' : 'BRAVO'}{p.isHost ? ' HOST' : ''}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="loader-room-row">
                                    <button className="loader-btn loader-btn-compact" onClick={() => handleSetTeam(0)}>
                                        ALPHA
                                    </button>
                                    <button className="loader-btn loader-btn-compact" onClick={() => handleSetTeam(1)}>
                                        BRAVO
                                    </button>
                                </div>
                                {isHost && (
                                    <>
                                        <select className="loader-select" value={gameMode} onChange={(e) => handleSetMode(e.target.value)}>
                                            <option value="tdm">TDM</option>
                                            <option value="conquest">CONQUEST</option>
                                            <option value="incursion">INCURSION</option>
                                        </select>
                                        <div className="loader-room-row">
                                            <input
                                                className="loader-input loader-input-code"
                                                value={seedInput}
                                                onChange={(e) => setSeedInput(e.target.value)}
                                                placeholder="SEED"
                                                inputMode="numeric"
                                            />
                                            <button className="loader-btn loader-btn-compact" onClick={handleSetSeed}>
                                                SET SEED
                                            </button>
                                        </div>
                                        <div className="loader-lobby-meta">SEED {lobbySeed}</div>
                                        <button className="loader-btn" onClick={handleStartGame}>
                                            START GAME
                                        </button>
                                    </>
                                )}
                            </>
                        )}

                        {lobbyError && <div className="loader-error">{lobbyError}</div>}

                        <div className="loader-divider" />
                        <button className="loader-btn" onClick={handleLoadMap}>
                            LOAD MAP
                        </button>
                        <button className="loader-btn loader-btn-secondary" onClick={handleOpenEditor}>
                            MAP EDITOR
                        </button>
                        <button className="loader-btn loader-btn-secondary" onClick={handleOpenViewer}>
                            VIEWER
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

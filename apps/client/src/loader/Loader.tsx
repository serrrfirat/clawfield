import { useProgress } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'

import usePhases, { PHASES } from '../stores/usePhases'
import useStore from '../stores/useStore'
import type { MapdefJson } from '../editor/editor-types'
import './loader.css'

const RING_COLOR = '#ffffff'
const RING_TRACK_COLOR = 'rgba(0, 0, 0, 0.1)'

export default function Loader() {
    const { active, progress } = useProgress()
    const phase = usePhases((s) => s.phase)
    const setPhase = usePhases((s) => s.setPhase)
    const setMapPlacements = useStore((s) => s.setMapPlacements)

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

        return () => animation.kill()
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

    const handleGenerate = () => {
        if (phase === PHASES.warmup) {
            setPhase(PHASES.start)
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
                        <button className="loader-btn" onClick={handleGenerate}>
                            GENERATE
                        </button>
                        <button className="loader-btn" onClick={handleLoadMap}>
                            LOAD MAP
                        </button>
                        <div className="loader-divider" />
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

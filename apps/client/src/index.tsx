import './style.css'
import ReactDOM from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import Experience from './world/Experience'
import { KeyboardControls } from '@react-three/drei'
import { Leva } from 'leva'
import Loader from './loader/Loader'
import { NetworkProvider } from './network/NetworkProvider'
import usePhases, { PHASES } from './stores/usePhases'
import GameHud from './ui/GameHud'
import ScreenTintOverlay from './ui/ScreenTintOverlay'

const params = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams()

const DEBUG = params.has('debug')
const EDITOR_MODE = params.has('mode') && params.get('mode') === 'editor'

/** Wrapper that disables Canvas pointer events while the Loader overlay is visible */
function CanvasWrapper({ children }: { children: React.ReactNode }) {
    const phase = usePhases((s) => s.phase)
    const blocked = phase !== PHASES.start
    return (
        <div style={{ width: '100%', height: '100%', pointerEvents: blocked ? 'none' : 'auto', position: 'relative' }}>
            {children}
            <ScreenTintOverlay />
        </div>
    )
}

const root = ReactDOM.createRoot(document.querySelector('#root')!)

if (EDITOR_MODE) {
    // Dynamic import to avoid loading game code in editor mode
    import('./editor/EditorCanvas').then(({ default: EditorCanvas }) => {
        root.render(<EditorCanvas />)
    })
} else {
    root.render(
        <NetworkProvider>
            <KeyboardControls
                map={[
                    { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
                    { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
                    { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
                    { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
                    { name: 'jump', keys: ['Space'] },
                    { name: 'sprint', keys: ['ShiftLeft', 'ShiftRight'] },
                    { name: 'reload', keys: ['KeyR'] },
                    { name: 'crouch', keys: ['KeyC', 'ControlLeft'] },
                ]}
            >
                <CanvasWrapper>
                    <Canvas
                        shadows
                        dpr={[1, 2]}
                        camera={{
                            fov: 45,
                            near: 0.1,
                            far: 200,
                            position: [0, 10, 12],
                        }}
                    >
                        <Experience />
                    </Canvas>
                </CanvasWrapper>
                <Leva collapsed hidden={!DEBUG} />
                <GameHud />
            </KeyboardControls>
            <Loader />
        </NetworkProvider>
    )
}

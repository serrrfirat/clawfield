import { Canvas } from '@react-three/fiber'
import EditorExperience from './EditorExperience'
import AssetPanel from './AssetPanel'
import PropertiesPanel from './PropertiesPanel'
import ToolBar from './ToolBar'
import ScatterPanel from './ScatterPanel'

export default function EditorCanvas() {
  return (
    <div style={rootStyle}>
      <ToolBar />
      <div style={bodyStyle}>
        <AssetPanel />
        <div style={canvasWrap}>
          <Canvas
            shadows
            dpr={[1, 2]}
            camera={{ fov: 45, near: 0.1, far: 500, position: [0, 30, 20] }}
          >
            <EditorExperience />
          </Canvas>
          <ScatterPanel />
        </div>
        <PropertiesPanel />
      </div>
    </div>
  )
}

const rootStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#111',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#ddd',
}

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  overflow: 'hidden',
}

const canvasWrap: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
}

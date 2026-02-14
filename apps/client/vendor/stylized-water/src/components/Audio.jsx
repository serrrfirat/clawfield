import { PositionalAudio } from "@react-three/drei"
import { useStore } from "../hooks/useStore"

export const Audio = () => {
  const audioEnabled = useStore((state) => state.audioEnabled)

  return (
    audioEnabled && (
      <>
        <group position={[0, 0, 0]}>
          <PositionalAudio
            autoplay
            loop
            url="/sounds/waves.mp3"
            distance={50}
          />
        </group>

        <group position={[-65, 35, -55]}>
          <PositionalAudio
            autoplay
            loop
            url="/sounds/birds.mp3"
            distance={30}
          />
        </group>
      </>
    )
  )
}

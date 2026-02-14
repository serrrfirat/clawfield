import clsx from "clsx"
import { Suspense } from "react"
import { Canvas } from "@react-three/fiber"
import { AdaptiveDpr } from "@react-three/drei"
import { Leva } from "leva"

import { Experience } from "./components/Experience"
import { UI } from "./ui"
import { Loading } from "./ui/Loading"

import { useStore } from "./hooks/useStore"

import s from "./ui/ui.module.scss"

function App() {
  const ready = useStore((state) => state.ready)

  return (
    <>
      <Loading />
      <Suspense>
        <div className={clsx(s.transition, { [s.show]: ready })}>
          <Leva hidden={!ready} />

          <Canvas camera={{ position: [30, 10, -30], fov: 35 }} shadows>
            <Experience />
            <AdaptiveDpr pixelated />
          </Canvas>

          <UI />
        </div>
      </Suspense>
    </>
  )
}

export default App

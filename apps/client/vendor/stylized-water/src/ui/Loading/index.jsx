import { clsx } from "clsx"
import { useEffect, useState } from "react"
import { useProgress } from "@react-three/drei"

import { useStore } from "../../hooks/useStore"

import s from "./loading.module.scss"

export const Loading = () => {
  const { progress, active } = useProgress()
  const [showLoader, setShowLoader] = useState(true)

  const ready = useStore((state) => state.ready)
  const setReady = useStore((state) => state.setReady)

  // Set a delay time to hide loader
  useEffect(() => {
    if (active) return

    setReady(true)
    const delayHide = setTimeout(() => setShowLoader(false), 5000)

    return () => {
      clearTimeout(delayHide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    showLoader && (
      <div
        className={clsx(
          s.wrapper,
          { [s.loaded]: !active },
          { [s.hide]: ready }
        )}
      >
        <div className={s.loading}>
          <div className={s.loader}>
            <span
              style={{ clipPath: `inset(0 ${100 - progress}% 0 0 round 3em)` }}
            ></span>
          </div>
        </div>
      </div>
    )
  )
}

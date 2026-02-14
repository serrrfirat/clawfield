import { clsx } from "clsx"

import { useStore } from "../../hooks/useStore"
import { Volume } from "./icons"

import s from "./sound.module.scss"

export const Sound = () => {
  const audioEnabled = useStore((state) => state.audioEnabled)
  const setAudioEnabled = useStore((state) => state.setAudioEnabled)

  const handleSound = () => {
    setAudioEnabled(!audioEnabled)
  }

  return (
    <div className={s.volume}>
      <button
        className={clsx(s.toggle, { [s.enabled]: audioEnabled })}
        onClick={() => handleSound()}
      >
        <Volume />
        <div className={s.label}>
          <SplitText>Enable sound</SplitText>
        </div>
      </button>
    </div>
  )
}

const SplitText = ({ children, delay = 0.2, time = 0.02 }) => {
  if (!children) return null

  const text = typeof children === "string" ? children : children.toString()
  const splitWord = text.split(" ")

  let universalCounter = 0 // Universal counter for all letters

  return (
    <>
      {splitWord.map((w, i) => (
        <span key={i} className={s.word}>
          {w.split("").map((c, il) => {
            const lDelay = delay + universalCounter * time
            universalCounter++

            return (
              <span
                key={il}
                className={s.letter}
                style={{ animationDelay: `${lDelay}s` }}
              >
                {c}
              </span>
            )
          })}
        </span>
      ))}
    </>
  )
}

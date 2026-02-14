import { Sound } from "./Sound"
import s from "./ui.module.scss"

export const UI = () => {
  return (
    <div className={s.ui}>
      <div className={s.top}>
        <Sound />
      </div>
    </div>
  )
}

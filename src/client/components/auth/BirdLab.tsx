/**
 * 小燕动作实验台（仅开发环境，`/login?birdlab`）：逐个触发情绪与小动作，评审动作自然度用。
 * AuthShell 以 `import.meta.env.DEV` 懒加载，生产构建整段裁掉；开发工具，文案不进 i18n。
 */
import type { BirdBehavior, BirdMood } from './bird-mood.ts'

const MOODS: BirdMood[] = ['idle', 'scout', 'cover', 'peek', 'captcha', 'error', 'success']
const BEHAVIORS: BirdBehavior[] = [
  'look',
  'tilt',
  'lookup',
  'preen',
  'chirp',
  'ruffle',
  'tailbob',
  'stretch',
  'shuffle',
  'shy',
  'love',
  'sleep',
]

export default function BirdLab({
  mood,
  onMood,
  onPlay,
}: {
  mood: BirdMood | null
  onMood: (m: BirdMood | null) => void
  onPlay: (b: BirdBehavior) => void
}) {
  const btn =
    'rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-hover aria-pressed:border-selected-border aria-pressed:bg-selected'
  return (
    <div
      className="fixed bottom-3 left-3 z-(--xz-z-sticky) flex max-w-[34rem] flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-(--xz-shadow-float)"
      data-testid="bird-lab"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-16 text-fg-muted text-xs">mood</span>
        <button
          type="button"
          className={btn}
          aria-pressed={mood === null}
          onClick={() => onMood(null)}
        >
          auto
        </button>
        {MOODS.map((m) => (
          <button
            key={m}
            type="button"
            className={btn}
            aria-pressed={mood === m}
            onClick={() => onMood(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-16 text-fg-muted text-xs">behavior</span>
        {BEHAVIORS.map((b) => (
          <button key={b} type="button" className={btn} onClick={() => onPlay(b)}>
            {b}
          </button>
        ))}
      </div>
    </div>
  )
}

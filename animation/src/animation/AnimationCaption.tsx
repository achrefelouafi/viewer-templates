import { useAnimationStore } from './store'

/** A template's title card (a room's name, the time of day), centred near the top of the scene. */
export function AnimationCaption() {
  const caption = useAnimationStore((s) => s.caption)
  if (!caption) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[18%] z-30 flex justify-center px-4" aria-live="polite">
      <div className="anim-caption flex flex-col items-center text-center text-white" key={caption.key}>
        <span className="font-light text-4xl tracking-[-0.03em] sm:text-5xl">{caption.title}</span>
        {caption.sub ? <span className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] opacity-80">{caption.sub}</span> : null}
      </div>
    </div>
  )
}


import { useEffect, useRef, useState } from 'react'
import type { ScanPhase } from '../../services/scanService'

interface Props {
  phase: ScanPhase
}

const ROCKET_IMAGES = {
  fetch: '/img/progress-bar-1.webp',
  classify: '/img/progress-bar-2.webp',
  save: '/img/progress-bar-3.webp',
}

const ESTIMATED_PROGRESS_LIMIT = 0.9
const ESTIMATED_PROGRESS_TIME_CONSTANT = 20_000

export function estimatedProgress(elapsedMs: number): number {
  return ESTIMATED_PROGRESS_LIMIT * (
    1 - Math.exp(-Math.max(0, elapsedMs) / ESTIMATED_PROGRESS_TIME_CONSTANT)
  )
}

function imgForProgress(p: number): string {
  if (p < 0.33) return ROCKET_IMAGES.fetch
  if (p < 0.66) return ROCKET_IMAGES.classify
  return ROCKET_IMAGES.save
}

export function ScanRocketProgressBar({ phase }: Props) {
  // Obrázek je jediný React state – mění se max 2× za scan
  const [rocketImg, setRocketImg] = useState(ROCKET_IMAGES.fetch)

  // DOM refs – pozici aktualizujeme přímo, bez React re-renderu
  const rocketRef = useRef<HTMLDivElement>(null)
  const trackLeftRef = useRef<HTMLDivElement>(null)
  const trackRightRef = useRef<HTMLDivElement>(null)

  const animRef = useRef<number>()
  const startTime = useRef<number | null>(null)
  const prevImg = useRef(ROCKET_IMAGES.fetch)

  useEffect(() => {
    if (phase === 'idle' || phase === 'error') {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      startTime.current = null
      return
    }

    if (!startTime.current) {
      startTime.current = performance.now()
    }

    function applyProgress(p: number) {
      const pct = p * 100

      if (rocketRef.current) {
        rocketRef.current.style.left = `calc(${pct}% - 32px)`
      }
      if (trackLeftRef.current) {
        trackLeftRef.current.style.width = `${pct}%`
      }
      if (trackRightRef.current) {
        trackRightRef.current.style.left = `${pct}%`
        trackRightRef.current.style.width = `${100 - pct}%`
      }

      // Obrázek – React state jen při změně
      const img = imgForProgress(p)
      if (img !== prevImg.current) {
        prevImg.current = img
        setRocketImg(img)
      }
    }

    function animate(now: number) {
      if (!startTime.current) return
      applyProgress(estimatedProgress(now - startTime.current))
      if (phase !== 'done') {
        animRef.current = requestAnimationFrame(animate)
      } else {
        applyProgress(1)
      }
    }

    animRef.current = requestAnimationFrame(animate)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [phase])

  if (phase === 'idle' || phase === 'error') return null

  return (
    <div className="relative w-full h-5 mt-2 mb-2" role="status" aria-label="Průběh scanu">
      {/* Track – vlevo (plná) */}
      <div
        ref={trackLeftRef}
        className="absolute top-1/2 h-2 bg-gray-800 rounded-full"
        style={{ left: 0, width: '0%', transform: 'translateY(-50%)', zIndex: 1 }}
      />
      {/* Track – vpravo (zeslabená) */}
      <div
        ref={trackRightRef}
        className="absolute top-1/2 h-2 bg-gray-800 rounded-full"
        style={{ left: '0%', width: '100%', opacity: 0.5, transform: 'translateY(-50%)', zIndex: 1 }}
      />
      {/* Raketa */}
      <div
        ref={rocketRef}
        className="absolute top-1/2"
        style={{ left: 'calc(0% - 32px)', transform: 'translateY(-50%)', width: 64, height: 64, zIndex: 2 }}
      >
        <img
          src={rocketImg}
          alt="Raketa"
          className="h-16 w-16 object-contain drop-shadow-lg"
          draggable={false}
        />
      </div>
    </div>
  )
}

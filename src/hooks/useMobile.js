import { useState, useEffect } from 'react'

export function useWidth() {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const fn = () => setWidth(window.innerWidth)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return width
}

export function useMobile() {
  return useWidth() <= 640
}

import { useState, useEffect } from 'react'

export function useMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640)
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 640)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return isMobile
}

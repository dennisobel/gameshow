import { createContext, useContext } from 'react'

/** The phone frame element — overlays portal into it so they stay "on device". */
export const FrameContext = createContext<HTMLElement | null>(null)
export const useFrame = () => useContext(FrameContext)

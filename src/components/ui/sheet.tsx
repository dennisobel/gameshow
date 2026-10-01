import { Dialog } from 'radix-ui'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { useFrame } from './frame'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  eyebrow?: ReactNode
  children: ReactNode
  className?: string
}

/** Bottom sheet rendered inside the phone frame (focus-trapped, Esc to close). */
export function Sheet({ open, onOpenChange, title, description, eyebrow, children, className }: Props) {
  const frame = useFrame()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && frame && (
          <Dialog.Portal forceMount container={frame}>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="absolute inset-0 z-40 bg-stage-950/70 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className={cn(
                  'safe-bottom absolute inset-x-0 bottom-0 z-50 flex max-h-[90%] flex-col rounded-t-[28px] border-t border-white/10 bg-stage-850 shadow-[0_-20px_60px_-10px_rgba(0,0,0,0.6)] outline-none',
                  className,
                )}
                initial={{ y: '100%' }}
                animate={{ y: 0, transition: { type: 'spring', damping: 30, stiffness: 320 } }}
                exit={{ y: '100%', transition: { duration: 0.2, ease: 'easeIn' } }}
              >
                <div className="mx-auto mt-2.5 h-1.5 w-11 rounded-full bg-white/20" aria-hidden="true" />
                <div className="flex items-start gap-3 px-5 pb-3 pt-3">
                  <div className="min-w-0 flex-1">
                    {eyebrow}
                    <Dialog.Title className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-wide text-ink">
                      {title}
                    </Dialog.Title>
                    <Dialog.Description className={description ? 'mt-1.5 text-sm text-ink-muted' : 'sr-only'}>
                      {description ?? title}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close
                    aria-label="Close"
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-stage-700 text-ink-soft transition-colors hover:bg-stage-600 hover:text-ink"
                  >
                    <XIcon size={20} weight="bold" />
                  </Dialog.Close>
                </div>
                <div className="scrollbar-none flex-1 overflow-y-auto px-5 pb-3">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Chunky "arcade" buttons: a solid lip underneath that compresses on press.
export const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-display font-extrabold uppercase tracking-wide transition-[transform,box-shadow,filter,opacity] duration-150 ease-out active:translate-y-[3px] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        gold: 'bg-linear-to-b from-gold-soft via-gold to-gold-deep text-stage-950 shadow-[0_5px_0_0_#8f5200,0_14px_28px_-10px_rgba(255,201,64,0.75)] hover:brightness-105 active:shadow-[0_2px_0_0_#8f5200,0_8px_18px_-10px_rgba(255,201,64,0.75)]',
        p1: 'bg-linear-to-b from-[#ff8cc4] to-p1 text-stage-950 shadow-[0_5px_0_0_var(--color-p1-deep),0_14px_28px_-12px_var(--color-p1)] hover:brightness-105 active:shadow-[0_2px_0_0_var(--color-p1-deep)]',
        p2: 'bg-linear-to-b from-[#8be9ff] to-p2 text-stage-950 shadow-[0_5px_0_0_var(--color-p2-deep),0_14px_28px_-12px_var(--color-p2)] hover:brightness-105 active:shadow-[0_2px_0_0_var(--color-p2-deep)]',
        host: 'bg-linear-to-b from-[#b9a3ff] to-host-deep text-white shadow-[0_5px_0_0_#35208f,0_14px_28px_-12px_var(--color-host)] hover:brightness-110 active:shadow-[0_2px_0_0_#35208f]',
        ember:
          'bg-linear-to-b from-gold via-ember to-[#e2244a] text-white text-stroke shadow-[0_5px_0_0_#8a1230,0_14px_30px_-10px_var(--color-ember)] hover:brightness-105 active:shadow-[0_2px_0_0_#8a1230]',
        outline:
          'border-2 border-stage-500 bg-stage-800/70 text-ink shadow-[0_4px_0_0_var(--color-stage-950)] hover:border-host hover:bg-stage-700/80 active:shadow-[0_1px_0_0_var(--color-stage-950)]',
        ghost: 'text-ink-soft hover:bg-white/5 hover:text-ink active:translate-y-0',
      },
      size: {
        xl: 'h-16 rounded-2xl px-8 text-[1.65rem]',
        lg: 'h-14 rounded-2xl px-6 text-xl',
        md: 'h-12 rounded-xl px-5 text-lg',
        sm: 'h-11 rounded-xl px-4 text-base',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'gold', size: 'lg' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, block, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size, block }), className)} {...props} />
))
Button.displayName = 'Button'

/** Round icon-only button with a required accessible label. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  ({ className, label, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-full border border-white/10 bg-stage-800/70 text-ink-soft backdrop-blur transition-[transform,background-color,color] duration-150 hover:bg-stage-700 hover:text-ink active:scale-95',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = 'IconButton'

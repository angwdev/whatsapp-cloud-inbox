import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground/80 flex field-sizing-content min-h-16 w-full rounded-xl border border-[var(--chat-border-strong)] bg-[var(--chat-input)] px-3.5 py-2.5 text-base leading-6 shadow-xs transition-[border-color,box-shadow] duration-150 outline-none hover:border-muted-foreground/35 focus-visible:border-primary/55 focus-visible:ring-4 focus-visible:ring-primary/15 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

"use client"

import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/** Follows the `.dark` class the theme toggle puts on <html>. */
function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("dark")

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light")
    sync()

    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return theme
}

function Toaster(props: ToasterProps) {
  const theme = useDocumentTheme()

  return (
    <Sonner
      theme={theme}
      position="top-center"
      closeButton
      offset={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border-[var(--chat-border-strong)] !bg-popover !text-popover-foreground !shadow-lg",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

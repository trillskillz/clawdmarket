'use client'

import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useModalFocus(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open || !dialogRef.current) return
    const dialog = dialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const backdrop = dialog.parentElement
    const main = backdrop?.parentElement
    const siteContent = main?.parentElement
    const background = [
      ...Array.from(main?.children || []).filter((node) => node !== backdrop),
      ...Array.from(siteContent?.parentElement?.children || []).filter((node) => node !== siteContent),
    ].filter((node): node is HTMLElement => node instanceof HTMLElement)
    const priorInert = background.map((node) => node.inert)
    background.forEach((node) => { node.inert = true })
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.getClientRects().length > 0)
    ;(dialog.querySelector<HTMLElement>('[data-dialog-close]') || focusables()[0] || dialog).focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) { event.preventDefault(); dialog.focus(); return }
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    function onFocusIn(event: FocusEvent) {
      if (!dialog.contains(event.target as Node)) (focusables()[0] || dialog).focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn)
      background.forEach((node, index) => { node.inert = priorInert[index] })
      previousFocus?.focus()
    }
  }, [open])

  return dialogRef
}

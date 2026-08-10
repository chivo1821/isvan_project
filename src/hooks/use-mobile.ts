import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// En el servidor no existe `window` — un valor fijo aca es lo que evita el
// mismatch de hidratacion (antes este hook evaluaba `window.innerWidth` en
// el primer render del cliente, que nunca coincide con el servidor; como
// SidebarProvider lo usa en el layout compartido, rompia la hidratacion en
// todas las paginas).
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

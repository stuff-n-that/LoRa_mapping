// Types for the plain-JS modules shared with the main map (see the @shared alias in vite.config.ts).
declare module '@shared/nodeRoles.js' {
  export const ROLE_CATEGORIES: { key: string; label: string }[]
}

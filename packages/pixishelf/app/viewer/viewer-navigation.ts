import { z } from 'zod'

const HISTORY_KEY = '__pixishelf_viewer_navigation__'
const navigationSchema = z.object({
  id: z.string(),
  randomSeed: z.number().int().nonnegative(),
  feedKey: z.string().optional(),
  verticalIndex: z.number().int().nonnegative().default(0),
  horizontalIndexes: z.record(z.string(), z.number().int().nonnegative()).default({})
})

export type ViewerNavigation = z.infer<typeof navigationSchema>

export function readViewerNavigation(): ViewerNavigation {
  const saved = navigationSchema.safeParse(window.history.state?.[HISTORY_KEY])
  return saved.success
    ? saved.data
    : {
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        randomSeed: Math.floor(Math.random() * 1000000),
        verticalIndex: 0,
        horizontalIndexes: {}
      }
}

export function saveViewerNavigation(navigation: ViewerNavigation) {
  // Route cleanup may run after Next has already moved to the destination entry.
  if (window.location.pathname !== '/viewer') return
  const current = window.history.state?.[HISTORY_KEY]
  if (current && current.id !== navigation.id) return
  window.history.replaceState({ ...window.history.state, [HISTORY_KEY]: navigation }, '')
}

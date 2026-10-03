import { createContext, useContext } from 'react'
import { useWorkspaceLayout } from './workspaceLayout'

export const WorkspaceLayoutContext = createContext<ReturnType<typeof useWorkspaceLayout> | null>(null)

export function useWorkspaceLayoutContext() {
  const workspace = useContext(WorkspaceLayoutContext)
  if (!workspace) throw new Error('Workspace layout must be read inside the app layout.')
  return workspace
}

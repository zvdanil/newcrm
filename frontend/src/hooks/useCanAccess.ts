import { useAuthStore } from '../store/auth.store'
import type { UserRole } from '../types'

export function useCanAccess(...roles: UserRole[]): boolean {
  const { user } = useAuthStore()
  if (!user) return false
  return roles.includes(user.role)
}

import { create } from 'zustand'
import type { AuthUser } from '../types'

interface AuthState {
  user: AuthUser | null
  token: string | null
  isAuthenticated: boolean
  setAuth: (user: AuthUser, token: string) => void
  logout: () => void
}

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('iris_user')
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: loadUser(),
  token: localStorage.getItem('iris_token'),
  isAuthenticated: !!localStorage.getItem('iris_token'),

  setAuth: (user, token) => {
    localStorage.setItem('iris_token', token)
    localStorage.setItem('iris_user', JSON.stringify(user))
    set({ user, token, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('iris_token')
    localStorage.removeItem('iris_user')
    set({ user: null, token: null, isAuthenticated: false })
  },
}))

import { apiClient } from './client'
import type { AuthUser } from '../types'

export const authApi = {
  login: async (email: string, password: string) => {
    const { data } = await apiClient.post<{ token: string; user: AuthUser }>('/auth/login', {
      email,
      password,
    })
    return data
  },

  me: async () => {
    const { data } = await apiClient.get<AuthUser>('/auth/me')
    return data
  },
}

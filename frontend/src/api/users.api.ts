import { apiClient } from './client'
import type { UserRole } from '../types'

export interface CrmUser {
  id: string
  email: string
  name: string | null
  role: UserRole
  is_active: boolean
  staff_id: string | null
  parent_id: string | null
  created_at: string
  staff_name: string | null
  parent_name: string | null
}

export interface InviteTokenInfo {
  email: string | null
  role: UserRole | null
  type: 'invite' | 'reset'
  staff_name: string | null
  parent_name: string | null
}

export const usersApi = {
  list: async (): Promise<CrmUser[]> => {
    const { data } = await apiClient.get<CrmUser[]>('/users')
    return data
  },

  update: async (id: string, payload: {
    name?: string | null
    role?: UserRole
    is_active?: boolean
    staff_id?: string | null
    parent_id?: string | null
  }): Promise<CrmUser> => {
    const { data } = await apiClient.put<CrmUser>(`/users/${id}`, payload)
    return data
  },

  setPassword: async (id: string, password: string): Promise<void> => {
    await apiClient.post(`/users/${id}/set-password`, { password })
  },

  invite: async (payload: {
    email: string
    role: UserRole
    staff_id?: string | null
    parent_id?: string | null
  }): Promise<{ inviteUrl: string }> => {
    const { data } = await apiClient.post<{ inviteUrl: string }>('/users/invite', payload)
    return data
  },

  resetLink: async (id: string): Promise<{ resetUrl: string }> => {
    const { data } = await apiClient.post<{ resetUrl: string }>(`/users/${id}/reset-link`)
    return data
  },

  getInviteInfo: async (token: string): Promise<InviteTokenInfo> => {
    const { data } = await apiClient.get<InviteTokenInfo>(`/invite/${token}`)
    return data
  },

  acceptInvite: async (token: string, payload: { password: string; name?: string }): Promise<void> => {
    await apiClient.post(`/invite/${token}/accept`, payload)
  },
}

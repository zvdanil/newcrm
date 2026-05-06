export type UserRole = 'owner' | 'admin' | 'manager' | 'accountant' | 'teacher' | 'parent'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
}

export interface Child {
  id: string
  full_name: string
  birth_date: string | null
  is_active: boolean
  note: string | null
  created_at: string
  updated_at?: string
  group_id: string | null
  group_name: string | null
  family_id: string | null
  family_name: string | null
  primary_parent_id?: string | null
  primary_parent_name?: string | null
  primary_parent_phone?: string | null
}

export interface Group {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface Parent {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  note: string | null
  created_at: string
}

export interface Family {
  id: string
  name: string
  note: string | null
  created_at: string
  primary_parent_id: string
  primary_parent_name: string
  primary_parent_phone: string | null
  children?: Child[]
  members?: Parent[]
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

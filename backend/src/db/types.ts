import type { Generated, ColumnType } from 'kysely'

export type UserRole = 'owner' | 'admin' | 'manager' | 'accountant' | 'teacher' | 'parent'

export interface UsersTable {
  id: Generated<string>
  email: string
  password_hash: string
  role: UserRole
  is_active: Generated<boolean>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface GroupsTable {
  id: Generated<string>
  name: string
  sort_order: Generated<number>
  is_active: Generated<boolean>
  created_at: Generated<Date>
}

export interface ParentsTable {
  id: Generated<string>
  full_name: string
  phone: string | null
  email: string | null
  user_id: string | null
  note: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface FamiliesTable {
  id: Generated<string>
  name: string
  primary_parent_id: string
  note: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface FamilyMembersTable {
  family_id: string
  parent_id: string
}

export interface ChildrenTable {
  id: Generated<string>
  full_name: string
  birth_date: ColumnType<Date | null, string | null, string | null>
  family_id: string | null
  group_id: string | null
  is_active: Generated<boolean>
  note: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface Database {
  users: UsersTable
  groups: GroupsTable
  parents: ParentsTable
  families: FamiliesTable
  family_members: FamilyMembersTable
  children: ChildrenTable
}

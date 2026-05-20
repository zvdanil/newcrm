import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'
import type { UserRole } from '../db/types.js'

const ADMIN_MANAGEABLE_ROLES: UserRole[] = ['manager', 'accountant', 'teacher', 'parent']

function canManageTarget(requestorRole: UserRole, targetRole: UserRole): boolean {
  if (requestorRole === 'owner') return true
  if (requestorRole === 'admin') return ADMIN_MANAGEABLE_ROLES.includes(targetRole)
  return false
}

function canAssignRole(requestorRole: UserRole, newRole: UserRole): boolean {
  if (requestorRole === 'owner') return true
  if (requestorRole === 'admin') return ADMIN_MANAGEABLE_ROLES.includes(newRole)
  return false
}

export async function usersRoutes(app: FastifyInstance) {
  // GET /api/users
  app.get('/', { preHandler: requireRole('owner', 'admin') }, async () => {
    return db
      .selectFrom('users as u')
      .leftJoin('staff as s',   's.id', 'u.staff_id')
      .leftJoin('parents as p', 'p.id', 'u.parent_id')
      .select([
        'u.id', 'u.email', 'u.name', 'u.role', 'u.is_active',
        'u.staff_id', 'u.parent_id', 'u.created_at',
        's.full_name as staff_name',
        'p.full_name as parent_name',
      ])
      .orderBy('u.created_at', 'asc')
      .execute()
  })

  // POST /api/users/invite — статичний маршрут ПЕРЕД /:id
  app.post<{
    Body: { email: string; role: UserRole; staff_id?: string | null; parent_id?: string | null }
  }>(
    '/invite',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const requestorRole = req.user.role as UserRole
      const { email, role, staff_id, parent_id } = req.body

      if (!email || !role) return reply.status(400).send({ error: 'BadRequest', message: 'email та role є обов\'язковими' })
      if (!canAssignRole(requestorRole, role))
        return reply.status(403).send({ error: 'Forbidden', message: 'Недостатньо прав для призначення цієї ролі' })
      if (role === 'teacher' && !staff_id)
        return reply.status(400).send({ error: 'BadRequest', message: 'Для ролі teacher необхідно вказати staff_id' })
      if (role === 'parent' && !parent_id)
        return reply.status(400).send({ error: 'BadRequest', message: 'Для ролі parent необхідно вказати parent_id' })

      const existing = await db.selectFrom('users').select('id')
        .where('email', '=', email.toLowerCase()).where('is_active', '=', true).executeTakeFirst()
      if (existing) return reply.status(409).send({ error: 'EmailAlreadyExists', message: 'Користувач з таким email вже активний' })

      if (staff_id) {
        const s = await db.selectFrom('staff').select('id').where('id', '=', staff_id).executeTakeFirst()
        if (!s) return reply.status(404).send({ error: 'StaffNotFound' })
      }
      if (parent_id) {
        const p = await db.selectFrom('parents').select('id').where('id', '=', parent_id).executeTakeFirst()
        if (!p) return reply.status(404).send({ error: 'ParentNotFound' })
      }

      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()

      await db.insertInto('user_invites').values({
        token,
        email: email.toLowerCase(),
        role,
        staff_id:   staff_id  ?? null,
        parent_id:  parent_id ?? null,
        invited_by: req.user.sub,
        type:       'invite',
        expires_at: expiresAt,
      }).execute()

      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
      return { inviteUrl: `${frontendUrl}/invite/${token}` }
    }
  )

  // PUT /api/users/:id
  app.put<{
    Params: { id: string }
    Body: { name?: string; role?: UserRole; is_active?: boolean; staff_id?: string | null; parent_id?: string | null }
  }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const requestorRole = req.user.role as UserRole
      const target = await db
        .selectFrom('users as u')
        .leftJoin('staff as s',   's.id', 'u.staff_id')
        .leftJoin('parents as p', 'p.id', 'u.parent_id')
        .select(['u.id', 'u.email', 'u.name', 'u.role', 'u.is_active', 'u.staff_id', 'u.parent_id', 'u.created_at',
          's.full_name as staff_name', 'p.full_name as parent_name'])
        .where('u.id', '=', req.params.id)
        .executeTakeFirst()

      if (!target) return reply.status(404).send({ error: 'NotFound' })
      if (!canManageTarget(requestorRole, target.role))
        return reply.status(403).send({ error: 'Forbidden', message: 'Недостатньо прав для редагування цього користувача' })

      const { name, role, is_active, staff_id, parent_id } = req.body
      const updates: Record<string, unknown> = { updated_at: new Date() }

      if (name !== undefined) updates.name = name || null

      if (role !== undefined) {
        if (!canAssignRole(requestorRole, role))
          return reply.status(403).send({ error: 'Forbidden', message: 'Недостатньо прав для призначення цієї ролі' })
        updates.role = role
        // При зміні ролі з teacher/parent — обнуляємо зв'язок
        if (target.role === 'teacher' && role !== 'teacher') updates.staff_id  = null
        if (target.role === 'parent'  && role !== 'parent')  updates.parent_id = null
      }

      if (is_active !== undefined) updates.is_active = is_active

      const effectiveRole = (role ?? target.role) as UserRole

      if (staff_id !== undefined) {
        if (effectiveRole === 'teacher' && staff_id) {
          const s = await db.selectFrom('staff').select('id').where('id', '=', staff_id).executeTakeFirst()
          if (!s) return reply.status(404).send({ error: 'StaffNotFound' })
          const dup = await db.selectFrom('users').select('id')
            .where('staff_id', '=', staff_id).where('id', '!=', req.params.id).executeTakeFirst()
          if (dup) return reply.status(409).send({ error: 'StaffAlreadyLinked' })
        }
        updates.staff_id = staff_id
      }

      if (parent_id !== undefined) {
        if (effectiveRole === 'parent' && parent_id) {
          const p = await db.selectFrom('parents').select('id').where('id', '=', parent_id).executeTakeFirst()
          if (!p) return reply.status(404).send({ error: 'ParentNotFound' })
          const dup = await db.selectFrom('users').select('id')
            .where('parent_id', '=', parent_id).where('id', '!=', req.params.id).executeTakeFirst()
          if (dup) return reply.status(409).send({ error: 'ParentAlreadyLinked' })
        }
        updates.parent_id = parent_id
      }

      await db.updateTable('users').set(updates).where('id', '=', req.params.id).execute()

      return db
        .selectFrom('users as u')
        .leftJoin('staff as s',   's.id', 'u.staff_id')
        .leftJoin('parents as p', 'p.id', 'u.parent_id')
        .select(['u.id', 'u.email', 'u.name', 'u.role', 'u.is_active', 'u.staff_id', 'u.parent_id', 'u.created_at',
          's.full_name as staff_name', 'p.full_name as parent_name'])
        .where('u.id', '=', req.params.id)
        .executeTakeFirstOrThrow()
    }
  )

  // POST /api/users/:id/reset-link
  app.post<{ Params: { id: string } }>(
    '/:id/reset-link',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const requestorRole = req.user.role as UserRole
      const target = await db.selectFrom('users').select(['id', 'email', 'role'])
        .where('id', '=', req.params.id).executeTakeFirst()
      if (!target) return reply.status(404).send({ error: 'NotFound' })
      if (!canManageTarget(requestorRole, target.role))
        return reply.status(403).send({ error: 'Forbidden' })

      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

      await db.insertInto('user_invites').values({
        token,
        email:      target.email,
        role:       null,
        staff_id:   null,
        parent_id:  null,
        invited_by: req.user.sub,
        type:       'reset',
        expires_at: expiresAt,
      }).execute()

      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
      return { resetUrl: `${frontendUrl}/reset/${token}` }
    }
  )

  // POST /api/users/:id/set-password
  app.post<{ Params: { id: string }; Body: { password: string } }>(
    '/:id/set-password',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const requestorRole = req.user.role as UserRole
      const target = await db.selectFrom('users').select(['id', 'role'])
        .where('id', '=', req.params.id).executeTakeFirst()
      if (!target) return reply.status(404).send({ error: 'NotFound' })
      if (!canManageTarget(requestorRole, target.role))
        return reply.status(403).send({ error: 'Forbidden' })
      if (!req.body.password || req.body.password.length < 8)
        return reply.status(400).send({ error: 'PasswordTooShort', message: 'Мінімум 8 символів' })

      const hash = await bcrypt.hash(req.body.password, 10)
      await db.updateTable('users')
        .set({ password_hash: hash, updated_at: new Date() })
        .where('id', '=', req.params.id).execute()
      return { ok: true }
    }
  )
}

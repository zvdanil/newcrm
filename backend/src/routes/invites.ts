import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { db } from '../db/index.js'

export async function inviteRoutes(app: FastifyInstance) {
  // GET /api/invite/:token — validate + return meta (public)
  app.get<{ Params: { token: string } }>('/:token', async (req, reply) => {
    const invite = await db
      .selectFrom('user_invites as i')
      .leftJoin('staff as s',   's.id', 'i.staff_id')
      .leftJoin('parents as p', 'p.id', 'i.parent_id')
      .select([
        'i.id', 'i.email', 'i.role', 'i.type',
        'i.expires_at', 'i.used_at',
        's.full_name as staff_name',
        'p.full_name as parent_name',
      ])
      .where('i.token', '=', req.params.token)
      .executeTakeFirst()

    if (!invite)
      return reply.status(404).send({ error: 'NotFound' })
    if (invite.used_at)
      return reply.status(410).send({ error: 'TokenUsed' })
    if (new Date(invite.expires_at as unknown as string) < new Date())
      return reply.status(410).send({ error: 'TokenExpired' })

    return {
      email:       invite.email,
      role:        invite.role,
      type:        invite.type,
      staff_name:  invite.staff_name ?? null,
      parent_name: invite.parent_name ?? null,
    }
  })

  // POST /api/invite/:token/accept — set password, activate user (public)
  app.post<{
    Params: { token: string }
    Body: { password: string; name?: string }
  }>('/:token/accept', async (req, reply) => {
    const { token } = req.params
    const { password, name } = req.body

    if (!password || password.length < 8)
      return reply.status(400).send({ error: 'PasswordTooShort', message: 'Мінімум 8 символів' })

    const invite = await db.selectFrom('user_invites').selectAll()
      .where('token', '=', token).executeTakeFirst()

    if (!invite)        return reply.status(404).send({ error: 'NotFound' })
    if (invite.used_at) return reply.status(410).send({ error: 'TokenUsed' })
    if (new Date(invite.expires_at as unknown as string) < new Date())
      return reply.status(410).send({ error: 'TokenExpired' })

    const hash = await bcrypt.hash(password, 10)

    if (invite.type === 'invite') {
      const existing = invite.email
        ? await db.selectFrom('users').selectAll()
            .where('email', '=', invite.email.toLowerCase()).executeTakeFirst()
        : null

      if (existing) {
        await db.updateTable('users').set({
          password_hash: hash,
          role:          invite.role ?? existing.role,
          staff_id:      invite.staff_id ?? null,
          parent_id:     invite.parent_id ?? null,
          name:          name ?? existing.name,
          is_active:     true,
          updated_at:    new Date(),
        }).where('id', '=', existing.id).execute()
      } else {
        if (!invite.email || !invite.role)
          return reply.status(400).send({ error: 'BadRequest', message: 'Некоректне запрошення' })
        await db.insertInto('users').values({
          email:         invite.email.toLowerCase(),
          password_hash: hash,
          role:          invite.role,
          staff_id:      invite.staff_id ?? null,
          parent_id:     invite.parent_id ?? null,
          name:          name ?? null,
          is_active:     true,
        }).execute()
      }
    } else {
      // type === 'reset' — update password only
      if (!invite.email) return reply.status(400).send({ error: 'BadRequest' })
      const user = await db.selectFrom('users').select(['id'])
        .where('email', '=', invite.email.toLowerCase()).executeTakeFirst()
      if (!user) return reply.status(404).send({ error: 'UserNotFound' })
      await db.updateTable('users')
        .set({ password_hash: hash, updated_at: new Date() })
        .where('id', '=', user.id).execute()
    }

    await db.updateTable('user_invites')
      .set({ used_at: new Date().toISOString() })
      .where('token', '=', token).execute()

    return { ok: true }
  })
}

import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { db } from '../db/index.js'
import { authenticate } from '../plugins/authenticate.js'

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post<{
    Body: { email: string; password: string }
  }>('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email.toLowerCase())
      .where('is_active', '=', true)
      .executeTakeFirst()

    if (!user) {
      return reply.status(401).send({ error: 'InvalidCredentials', message: 'Невірний email або пароль' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return reply.status(401).send({ error: 'InvalidCredentials', message: 'Невірний email або пароль' })
    }

    const token = app.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' }
    )

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    }
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: authenticate }, async (request) => {
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'role', 'is_active', 'created_at'])
      .where('id', '=', request.user.sub)
      .executeTakeFirst()

    return user ?? null
  })

  // POST /api/auth/logout (stateless JWT — клиент удаляет токен)
  app.post('/logout', { preHandler: authenticate }, async () => {
    return { ok: true }
  })

  // POST /api/auth/refresh (выдаёт новый токен на основе текущего валидного)
  app.post('/refresh', { preHandler: authenticate }, async (request) => {
    const { sub, email, role } = request.user
    const token = app.jwt.sign(
      { sub, email, role },
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' }
    )
    return { token }
  })
}

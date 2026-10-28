import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { db } from '../db/index.js'
import { authenticate } from '../plugins/authenticate.js'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15
// Dummy bcrypt hash to equalize response times when user is not found (anti-timing attack)
const DUMMY_HASH = '$2a$10$vI8aWBnW3fID.ZQ4/zo1G.q1lRps.9cGLcZEiGPEWi9GQOmMX3e6O'

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post<{
    Body: { email: string; password: string }
  }>('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
        errorResponseBuilder: (request, context) => ({
          statusCode: 429,
          error: 'TooManyRequests',
          message: 'Забагато спроб входу з вашої IP-адреси. Будь ласка, зачекайте 1 хвилину.',
          retryAfter: Math.ceil(context.ttl / 1000),
        }),
      },
    },
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
    const normalizedEmail = email.trim().toLowerCase()

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', normalizedEmail)
      .where('is_active', '=', true)
      .executeTakeFirst()

    if (!user) {
      // Run dummy compare to mitigate user enumeration through timing attacks
      await bcrypt.compare(password, DUMMY_HASH)
      return reply.status(401).send({ error: 'InvalidCredentials', message: 'Невірний email або пароль' })
    }

    // Check if account is temporarily locked
    if (user.locked_until) {
      const lockUntilDate = new Date(user.locked_until)
      const now = new Date()
      if (lockUntilDate > now) {
        const minutesLeft = Math.max(1, Math.ceil((lockUntilDate.getTime() - now.getTime()) / 60000))
        return reply.status(429).send({
          error: 'AccountLocked',
          message: `Акаунт тимчасово заблоковано через часті помилки входу. Спробуйте через ${minutesLeft} хв або зверніться до адміністратора.`,
        })
      }
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      const currentAttempts = (user.failed_login_attempts ?? 0)
      const newAttempts = currentAttempts + 1

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        await db
          .updateTable('users')
          .set({
            failed_login_attempts: newAttempts,
            locked_until: lockUntil,
            updated_at: new Date(),
          })
          .where('id', '=', user.id)
          .execute()

        return reply.status(429).send({
          error: 'AccountLocked',
          message: `Акаунт тимчасово заблоковано на ${LOCKOUT_MINUTES} хв через ${MAX_FAILED_ATTEMPTS} невдалих спроб входу.`,
        })
      }

      await db
        .updateTable('users')
        .set({
          failed_login_attempts: newAttempts,
          updated_at: new Date(),
        })
        .where('id', '=', user.id)
        .execute()

      const remaining = MAX_FAILED_ATTEMPTS - newAttempts
      return reply.status(401).send({
        error: 'InvalidCredentials',
        message: `Невірний email або пароль. Залишилося спроб: ${remaining}`,
      })
    }

    // Successful login: reset failed attempts and lockout if any
    if ((user.failed_login_attempts ?? 0) > 0 || user.locked_until) {
      await db
        .updateTable('users')
        .set({
          failed_login_attempts: 0,
          locked_until: null,
          updated_at: new Date(),
        })
        .where('id', '=', user.id)
        .execute()
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

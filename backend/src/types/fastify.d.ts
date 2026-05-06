import type { UserRole } from '../db/types.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      email: string
      role: UserRole
    }
    user: {
      sub: string
      email: string
      role: UserRole
    }
  }
}

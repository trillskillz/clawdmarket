type RuntimeEnvironment = Record<string, string | undefined>

export function isPasswordResetEmailConfigured(env: RuntimeEnvironment = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.PASSWORD_RESET_FROM_EMAIL?.trim())
}

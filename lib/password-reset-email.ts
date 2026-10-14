type RuntimeEnvironment = Record<string, string | undefined>

export function isPasswordResetEmailConfigured(env: RuntimeEnvironment = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.PASSWORD_RESET_FROM_EMAIL?.trim())
}

export function passwordResetEmailReadiness(env: RuntimeEnvironment = process.env) {
  const configured = isPasswordResetEmailConfigured(env)
  return { configured, status: configured ? 'configured_delivery_unverified' : 'unconfigured',
    scope: 'email_password_recovery_only',
    operator_instruction: configured
      ? 'Verify delivery using the email provider sandbox or an approved test inbox. Configuration alone does not prove deliverability.'
      : 'Set RESEND_API_KEY and PASSWORD_RESET_FROM_EMAIL for a verified sender, then verify sandbox recovery. Wallet and API access have separate health checks.' }
}

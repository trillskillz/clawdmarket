import 'server-only'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export function reportInternalError(
  context: string,
  error: unknown,
  metadata: Record<string, unknown> = {},
) {
  const errorId = `err_${crypto.randomUUID()}`
  logger.error(context, {
    error_id: errorId,
    error_name: error instanceof Error ? error.name : typeof error,
    error_message: error instanceof Error ? error.message : String(error),
    ...metadata,
  })
  return errorId
}

export function internalErrorResponse(
  context: string,
  error: unknown,
  options: { code?: string; message?: string; status?: number } = {},
) {
  const errorId = reportInternalError(context, error)
  return NextResponse.json({
    error: options.code || 'internal_error',
    message: options.message || 'An unexpected error occurred. Retry or contact support with the error ID.',
    error_id: errorId,
  }, { status: options.status || 500 })
}

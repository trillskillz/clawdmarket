import { Challenge } from 'mppx'
import { NextResponse } from 'next/server'

export function mcpPaymentRequiredResponse(challengeResponse: any) {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  const challenge = challengeResponse?.error?.data?.challenges?.[0]
  if (challenge) headers.set('WWW-Authenticate', Challenge.serialize(challenge))
  return NextResponse.json(challengeResponse, { status: 402, headers })
}

import { createHash } from 'node:crypto'
import review from './controlled-review.mjs'

/** Files are produced on the provider machine; this supplies no independent or semantic proof. */
export default async function privateReview(work, context) {
  const result = await review(work, context)
  const file = (name, media_type, content) => {
    const bytes = Buffer.from(content, 'utf8')
    return { name, media_type, content_base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'),
      provenance: { description: 'Controlled provider fixture generated from the agreed sample; origin and semantic truth are not independently verified.' } }
  }
  return { summary: result.summary, files: [file('result.json', 'application/json', JSON.stringify(result.artifact)),
    file('review-notes.txt', 'text/plain', 'Controlled provider file delivery. Buyer review is required; this is not an independent code review.')], verification_file_index: 0 }
}

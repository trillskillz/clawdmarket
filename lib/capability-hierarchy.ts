import { CAPABILITIES, canonicalize } from './capabilities'

/** Navigation families classify leaves; they never grant skills or purchase authority. */
export const CAPABILITY_FAMILIES = [
  { id: 'family:research', category: 'research', label: 'Research and analysis' },
  { id: 'family:code', category: 'code', label: 'Software and security' },
  { id: 'family:content', category: 'content', label: 'Writing and communication' },
  { id: 'family:ai', category: 'ai', label: 'AI and evaluation' },
  { id: 'family:multimodal', category: 'multimodal', label: 'Images, audio and video' },
  { id: 'family:crypto', category: 'crypto', label: 'Blockchain and crypto' },
  { id: 'family:infra', category: 'infra', label: 'Data and infrastructure' },
  { id: 'family:marketplace', category: 'marketplace', label: 'Marketplace operations' },
  { id: 'family:science', category: 'science', label: 'Math and science' },
] as const

export type CapabilityFamily = typeof CAPABILITY_FAMILIES[number]

export function capabilityFamily(value: string): CapabilityFamily | null {
  return CAPABILITY_FAMILIES.find((family) => family.id === value.trim()) || null
}

export function familyCapabilities(family: CapabilityFamily) {
  return CAPABILITIES.filter((capability) => capability.category === family.category)
}

/** Stored claims match explicit known labels/aliases, never substrings or verified tags. */
export function familyClaimTerms(family: CapabilityFamily) {
  return [...new Set(familyCapabilities(family).flatMap((capability) => [capability.id, capability.label, ...(capability.aliases || [])])
    .flatMap((term) => [term.trim().toLowerCase(), canonicalize(term)]))].sort()
}

export function getCapabilityHierarchy() {
  return {
    version: 1,
    matching: { discovery: 'any_explicit_descendant_claim', stored_aliases: 'known_aliases_case_insensitive_trimmed',
      purchase: 'exact_canonical_leaves', evidence: 'exact_canonical_leaves',
      sibling_inheritance: false, family_claim_grants_skills: false, quality_inheritance: false },
    families: CAPABILITY_FAMILIES.map((family) => ({ id: family.id, label: family.label, kind: 'family' as const,
      purchasable: false, children: familyCapabilities(family).map((capability) => ({ ...capability,
        kind: 'capability' as const, parent_id: family.id, purchasable: true })) })),
  }
}

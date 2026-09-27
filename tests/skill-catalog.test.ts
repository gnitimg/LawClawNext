import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { DEFAULT_ENABLED_SKILL_IDS, discoverLawClawSkills } from '../src/main/skill-catalog'

test('bundled skill catalog preserves the original LawClaw skills and formal delivery protocol', () => {
  const skills = discoverLawClawSkills(resolve('resources/lawclaw'))
  const ids = new Set(skills.map((skill) => skill.id))
  assert.ok(skills.length >= 42)
  for (const required of [
    'case-preprocess',
    'civil-defense-statement',
    'evidence-directory',
    'json-canvas',
    'lawclaw-delivery-protocol',
    'legal-analysis-quality',
    'legal-article-verify',
    'opponent-prediction',
    'trial-outline',
  ]) assert.ok(ids.has(required), `missing ${required}`)
  for (const enabled of DEFAULT_ENABLED_SKILL_IDS) assert.ok(ids.has(enabled), `default skill is not bundled: ${enabled}`)
  assert.ok(skills.every((skill) => skill.entrypoints.includes(`skills/${skill.id}/SKILL.md`)))
  assert.ok(skills.every((skill) => skill.entrypoints.every((path) => !path.includes('Zone.Identifier'))))
})

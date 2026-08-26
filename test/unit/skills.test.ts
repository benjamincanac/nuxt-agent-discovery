import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { scanSkills } from '../../src/skills'
import type { ConsolaInstance } from 'consola'

/** Collects the warnings, which are the whole point of a skipped skill. */
function createLogger() {
  const warnings: string[] = []
  return { warnings, logger: { warn: (message: string) => warnings.push(message) } as unknown as ConsolaInstance }
}

async function withSkill(name: string, content: string, files: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-skills-'))
  await mkdir(join(dir, name), { recursive: true })
  await writeFile(join(dir, name, 'SKILL.md'), content)
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(dir, name, path, '..'), { recursive: true })
    await writeFile(join(dir, name, path), body)
  }
  return dir
}

const valid = '---\nname: my-skill\ndescription: Does a thing.\n---\n\n# My skill\n'

describe('scanSkills', () => {
  it('reads a skill and lists its files with `SKILL.md` first', async () => {
    const { logger, warnings } = createLogger()
    const dir = await withSkill('my-skill', valid, { 'references/two.md': 'b', 'references/one.md': 'a' })

    expect(await scanSkills(dir, logger)).toEqual([{
      name: 'my-skill',
      description: 'Does a thing.',
      files: ['SKILL.md', 'references/one.md', 'references/two.md']
    }])
    expect(warnings).toEqual([])
  })

  it('reports invalid frontmatter as a syntax error, not a missing description', async () => {
    const { logger, warnings } = createLogger()
    // An unquoted description holding a `: ` is the common way to write this.
    const dir = await withSkill('my-skill', '---\nname: my-skill\ndescription: Does a thing: really.\n---\n')

    expect(await scanSkills(dir, logger)).toEqual([])
    expect(warnings[0]).toContain('invalid `SKILL.md` frontmatter')
    expect(warnings[0]).not.toContain('no `description`')
  })

  it('reports a missing description as a missing description', async () => {
    const { logger, warnings } = createLogger()
    const dir = await withSkill('my-skill', '---\nname: my-skill\n---\n')

    expect(await scanSkills(dir, logger)).toEqual([])
    expect(warnings[0]).toContain('no `description`')
  })

  it('reports frontmatter that is not a mapping', async () => {
    const { logger, warnings } = createLogger()
    const dir = await withSkill('my-skill', '---\n- one\n- two\n---\n')

    expect(await scanSkills(dir, logger)).toEqual([])
    expect(warnings[0]).toContain('not a mapping')
  })

  it('reports a `SKILL.md` with no frontmatter at all', async () => {
    const { logger, warnings } = createLogger()
    const dir = await withSkill('my-skill', '# My skill\n')

    expect(await scanSkills(dir, logger)).toEqual([])
    expect(warnings[0]).toContain('no `SKILL.md` frontmatter')
  })

  it('skips a name that disagrees with its directory', async () => {
    const { logger, warnings } = createLogger()
    const dir = await withSkill('my-skill', '---\nname: other-skill\ndescription: Does a thing.\n---\n')

    expect(await scanSkills(dir, logger)).toEqual([])
    expect(warnings[0]).toContain('does not match its directory name')
  })

  it('returns nothing when the directory does not exist', async () => {
    const { logger } = createLogger()
    expect(await scanSkills(join(tmpdir(), 'agent-skills-missing'), logger)).toEqual([])
  })
})

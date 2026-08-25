import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'pathe'
import { parse as parseYaml } from 'yaml'
import type { ConsolaInstance } from 'consola'
import type { SkillEntry } from './runtime/shared/types'

/**
 * Agent Skills discovery.
 *
 * A skill is a directory holding a `SKILL.md` with `name` and `description`
 * frontmatter, plus any number of reference files. The catalog is scanned at
 * build time so `/.well-known/skills/index.json` is generated rather than
 * hand-maintained, which is where the three sites that ship skills today all
 * drift: a reference file gets added and the index keeps listing the old set.
 *
 * Naming follows the Agent Skills spec: lowercase alphanumeric and single
 * hyphens, 64 characters at most, matching the directory name.
 */

const SKILL_NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const MAX_NAME_LENGTH = 64

function parseFrontmatter(content: string): { name?: string, description?: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) {
    return null
  }
  try {
    return parseYaml(match[1])
  } catch {
    return null
  }
}

function isValidSkillName(name: string, dirName: string, logger: ConsolaInstance): boolean {
  if (name.length > MAX_NAME_LENGTH) {
    logger.warn(`Skill "${name}" exceeds the ${MAX_NAME_LENGTH} character limit.`)
    return false
  }
  if (!SKILL_NAME_REGEX.test(name) || name.includes('--')) {
    logger.warn(`Skill name "${name}" does not match the Agent Skills naming spec.`)
    return false
  }
  if (name !== dirName) {
    logger.warn(`Skill name "${name}" does not match its directory name "${dirName}".`)
    return false
  }
  return true
}

async function listFiles(dir: string, base = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...await listFiles(join(dir, entry.name), path))
    } else {
      files.push(path)
    }
  }
  return files
}

/** Every skill in `dir`, with its files listed from disk. `SKILL.md` first. */
export async function scanSkills(dir: string, logger: ConsolaInstance): Promise<SkillEntry[]> {
  if (!existsSync(dir)) {
    return []
  }

  const catalog: SkillEntry[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const skillDir = join(dir, entry.name)
    const skillMd = join(skillDir, 'SKILL.md')
    if (!existsSync(skillMd)) {
      continue
    }

    const frontmatter = parseFrontmatter(await readFile(skillMd, 'utf8'))
    if (!frontmatter?.description) {
      logger.warn(`Skipping skill "${entry.name}": no \`description\` in the \`SKILL.md\` frontmatter.`)
      continue
    }

    const name = frontmatter.name || entry.name
    if (!isValidSkillName(name, entry.name, logger)) {
      continue
    }

    // Dotfiles are editor and tooling noise, never part of a published skill.
    const files = (await listFiles(skillDir)).filter(file => !file.split('/').some(segment => segment.startsWith('.')))

    catalog.push({
      name,
      description: frontmatter.description,
      files: ['SKILL.md', ...files.filter(file => file !== 'SKILL.md').sort()]
    })
  }

  return catalog.sort((a, b) => a.name.localeCompare(b.name))
}

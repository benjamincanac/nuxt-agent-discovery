/**
 * The Agent Skills well-known prefix. One constant, because the route
 * registration, the prerender list, the discovery links, the OpenAPI document
 * and the file route all have to agree on it.
 */
export const SKILLS_PREFIX = '/.well-known/skills/'

/** The generated skills index document. */
export const SKILLS_INDEX = `${SKILLS_PREFIX}index.json`

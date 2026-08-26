import { defineCollection, defineContentConfig } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: { include: '**', exclude: ['pages/**', 'data.yml'] }
    }),
    // Not named by any `llms.sections` entry, so it must stay out of
    // `llms-full.txt` while still being served as raw markdown.
    pages: defineCollection({
      type: 'page',
      source: 'pages/**'
    }),
    // A YAML page: data, no markdown body.
    data: defineCollection({
      type: 'page',
      source: 'data.yml'
    })
  }
})

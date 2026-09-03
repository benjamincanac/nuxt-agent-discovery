import { defineNuxtModule } from '@nuxt/kit'

/**
 * Stands in for `@nuxtjs/i18n`: its module name and config key, none of its
 * routing. The homepage detection reads `nuxt.options.i18n` off an installed
 * module of that name and nothing else, and this fixture spells its locale
 * routes out by hand under `pages/`, which the real module would prefix again.
 */
export default defineNuxtModule({
  meta: { name: '@nuxtjs/i18n', configKey: 'i18n' },
  setup() {}
})

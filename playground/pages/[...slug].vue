<script setup lang="ts">
const route = useRoute()

const { data: page } = await useAsyncData(route.path, () => {
  return queryCollection('docs').path(route.path).first()
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page Not Found', fatal: true })
}

useCanonical(() => route.path === '/' ? '/raw/index.md' : `${route.path}.md`)
</script>

<template>
  <main>
    <ContentRenderer
      v-if="page"
      :value="page"
    />
    <p v-else>
      Page not found
    </p>
  </main>
</template>

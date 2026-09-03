<script setup lang="ts">
defineProps<{ error: { statusCode: number } }>()

// The HTML half of the markdown error body: same registry, no hardcoded list.
const resources = useAgentResources()
</script>

<template>
  <main>
    <h1>{{ error.statusCode }}</h1>
    <ul>
      <li
        v-for="resource in resources"
        :key="`${resource.rel} ${resource.href}`"
      >
        <a
          :href="resource.href"
          :type="resource.type"
        >{{ resource.title }}</a>
      </li>
    </ul>
  </main>
</template>

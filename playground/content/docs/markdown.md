---
title: Markdown
description: Constructs the raw markdown has to carry through unchanged.
---

## Nested code fences

A four-backtick fence wrapping a README that has fences of its own.

````md [README.md]
# My Project

## Setup

```bash
# npm
npm install
```

```bash
# pnpm
pnpm install
```
````

## Components

::page-hero{class="dark:bg-gradient-to-b from-neutral-900 to-neutral-950"}
---
orientation: horizontal
---
#title
Ship Beautiful [Documentation]{.text-primary}.

#links
  :::u-button{to="/docs/getting-started" size="xl"}
  Get started
  :::

  :::u-button{to="https://github.com/nuxt/nuxt" target="_blank"}
  Use this template
  :::
::

::page-section
  :::page-cta
  ---
  links:
    - label: Start building
      to: '/docs/getting-started'
      trailingIcon: i-lucide-arrow-right
    - label: View on GitHub
      to: 'https://github.com/nuxt/nuxt'
      target: _blank
  title: Say "hello" to the module's docs
  class: dark:bg-neutral-950
  ---
  Everything an agent needs.
  :::
::

::code-preview
---
code: |
  export default defineNuxtConfig({
    modules: ['nuxt-agent-discovery']
  })
filename: nuxt.config.ts
---
Preview.
::

# Changelog

## [0.1.1](https://github.com/benjamincanac/nuxt-agent-discovery/compare/v0.1.0...v0.1.1) (2026-08-28)

### Bug Fixes

* **openapi:** dedupe operation ids against the caller's ([#7](https://github.com/benjamincanac/nuxt-agent-discovery/issues/7)) ([bc7bf82](https://github.com/benjamincanac/nuxt-agent-discovery/commit/bc7bf82bce308d6711fe1655b9e14b7ff7719072))
* set Vary on the markdown representations ([#6](https://github.com/benjamincanac/nuxt-agent-discovery/issues/6)) ([bd99433](https://github.com/benjamincanac/nuxt-agent-discovery/commit/bd99433fe64a8b990be6b77f6a8caf7db3c1548a))

## [0.1.0](https://github.com/benjamincanac/nuxt-agent-discovery/compare/v0.0.1...v0.1.0) (2026-08-27)

### Features

* let sites extend the discovery layer ([c636719](https://github.com/benjamincanac/nuxt-agent-discovery/commit/c636719e9c0bfd63ca07486b6e7187acd1388f18))
* **llms:** generate llms.txt from the content adapter ([cf61a77](https://github.com/benjamincanac/nuxt-agent-discovery/commit/cf61a777f4144263a0d5fbf367b3ef975dccf4e1))
* **mcp:** export the pieces an agent docs tool is built from ([9d044cc](https://github.com/benjamincanac/nuxt-agent-discovery/commit/9d044cc4ae7ff3d6885bbb8412738899c363f7d8))
* **module:** give `excludePrefixes` the `extend` / `replace` shape ([c0761f3](https://github.com/benjamincanac/nuxt-agent-discovery/commit/c0761f3936461e9414cea34f6fa872a42265cd31))
* **module:** re-export AgentListEntry and AgentSectionSelector ([43a1a01](https://github.com/benjamincanac/nuxt-agent-discovery/commit/43a1a01b726853d22096962c71711e6adaf589c6))
* **openapi:** contribute the discovery layer as OpenAPI fragments ([e11c713](https://github.com/benjamincanac/nuxt-agent-discovery/commit/e11c7137fb6e193e0bdc622c533fea5bb5636243))
* **openapi:** describe the MCP endpoint alongside its server card ([2ca66cc](https://github.com/benjamincanac/nuxt-agent-discovery/commit/2ca66ccb9f0cb7449ff6392f12149dfbf57f1351))
* **openapi:** give every generated operation a stable `operationId` ([841b506](https://github.com/benjamincanac/nuxt-agent-discovery/commit/841b506343937beaa2077244e6db5fefcf6df0ef))
* **raw:** let `agent-discovery:index` set the title and description ([497965c](https://github.com/benjamincanac/nuxt-agent-discovery/commit/497965c7fcd5c337134085675d9d21f57128a30c))
* **sitemap:** group sitemap.md into sections ([db499fb](https://github.com/benjamincanac/nuxt-agent-discovery/commit/db499fbf2b0f3fb7862d6d1d03c0143bf49736e8))
* **sitemap:** keep the raw prefix out of @nuxtjs/sitemap ([8952be9](https://github.com/benjamincanac/nuxt-agent-discovery/commit/8952be95661a68d89610330441ce1ff3eb931e21))
* **skills:** serve agent skills with a generated index ([1d42d3e](https://github.com/benjamincanac/nuxt-agent-discovery/commit/1d42d3e9e2cf972db9628f7e39ab2af0943b1912))

### Bug Fixes

* alias [#agent](https://github.com/benjamincanac/nuxt-agent-discovery/issues/agent)-discovery app-side so server routes typecheck ([1bac937](https://github.com/benjamincanac/nuxt-agent-discovery/commit/1bac937b7a49f691bfe44ab14dbc26154b527484)), references [#agent-discovery](https://github.com/benjamincanac/nuxt-agent-discovery/issues/agent-discovery)
* **comark:** render the same document the content adapter does ([1d171df](https://github.com/benjamincanac/nuxt-agent-discovery/commit/1d171df64b61f022b7db2290207c8da8d63c47e1))
* **content:** stringify with the minimark @nuxt/content resolves ([0566da6](https://github.com/benjamincanac/nuxt-agent-discovery/commit/0566da687b6bb4671946f59c73d184e2f27a2c86))
* **content:** strip the highlighter style node from raw markdown ([59a796f](https://github.com/benjamincanac/nuxt-agent-discovery/commit/59a796ff7f55156b807408302aaad51538999847))
* **discovery:** cache the documents that cannot change between builds ([bf9593b](https://github.com/benjamincanac/nuxt-agent-discovery/commit/bf9593b46ef4d48b8f8a881bb0861bd7dba91598))
* **llms:** absolutise same-origin links in llms.txt ([74a4a6f](https://github.com/benjamincanac/nuxt-agent-discovery/commit/74a4a6fa70b89c9d89e4a8a155a5eb356fb7b116))
* **llms:** keep pages without a markdown body out of the bridge ([c200a7c](https://github.com/benjamincanac/nuxt-agent-discovery/commit/c200a7cfbaaebef3780517208ec9a84fb59ac427))
* **mcp:** detect the toolkit at `modules:done` ([1b0db45](https://github.com/benjamincanac/nuxt-agent-discovery/commit/1b0db45d7c1a983c0f640ef9be81f736286d46b9))
* **module:** copy the default arrays into the negotiation config ([78b207f](https://github.com/benjamincanac/nuxt-agent-discovery/commit/78b207f3cfaef580f379210067dea4eacc879450))
* **module:** detect the companion modules at `modules:done` ([be178af](https://github.com/benjamincanac/nuxt-agent-discovery/commit/be178af31af45a9d6e412a46d4b72fc153ae4d81))
* **module:** exclude `/sitemap.md` whenever its link is registered ([3b7b448](https://github.com/benjamincanac/nuxt-agent-discovery/commit/3b7b448ae154f152e1faad9449ec59058a59a236))
* **module:** only cache-redirect the rules the routes negotiate ([0545aa2](https://github.com/benjamincanac/nuxt-agent-discovery/commit/0545aa21260066a2e385d0ce649e74468a79444a))
* **playground:** prepare the module before the vercel build ([d93b321](https://github.com/benjamincanac/nuxt-agent-discovery/commit/d93b321000f0d2da611c67110de639c692db3a7f))
* pre-publish correctness pass ([#5](https://github.com/benjamincanac/nuxt-agent-discovery/issues/5)) ([e30e0d0](https://github.com/benjamincanac/nuxt-agent-discovery/commit/e30e0d00a616ab87eb1c6429abfc55d975269d90))
* **raw:** omit an empty title or description from the frontmatter ([e06fc02](https://github.com/benjamincanac/nuxt-agent-discovery/commit/e06fc02cdde70daffb9b556e6b225e7c2eac8127))
* **robots:** contribute through the robots:config hook ([68f55c1](https://github.com/benjamincanac/nuxt-agent-discovery/commit/68f55c173ee38e5222eb1aa22951bb9ab7dafa4d))
* **sitemap:** resolve the markdown twins through rawUrl ([abd2dd1](https://github.com/benjamincanac/nuxt-agent-discovery/commit/abd2dd1a7a5046c39b2bc592b355424f0d59c95c))
* **skills:** quote the description holding a colon ([095e714](https://github.com/benjamincanac/nuxt-agent-discovery/commit/095e714045cbadf3d24f70a88621cc912d155739))
* **skills:** rename migrate skill ([8947016](https://github.com/benjamincanac/nuxt-agent-discovery/commit/894701650cb93b003a89621485b049d9474ddd60))
* **skills:** say why a `SKILL.md` frontmatter could not be read ([f758ba5](https://github.com/benjamincanac/nuxt-agent-discovery/commit/f758ba5329d6011d15fc8e4d5f7460dcd8b9a27b))
* **types:** keep the module's own source type-checking inside a consuming site ([ca8ccc1](https://github.com/benjamincanac/nuxt-agent-discovery/commit/ca8ccc1af6a974a52f73bc539eba66f57993efb9))
* **vercel:** honour `Accept: text/markdown;q=0` at the edge ([6ddc1aa](https://github.com/benjamincanac/nuxt-agent-discovery/commit/6ddc1aae89e5896862fe8b083dd80c996bf66d0d))

## 0.0.1 (2026-08-25)

### Features

* markdown content negotiation and discovery documents ([ef0663f](https://github.com/benjamincanac/nuxt-agent-discovery/commit/ef0663f448b6c0a4931f939c5148536ece764bc9))

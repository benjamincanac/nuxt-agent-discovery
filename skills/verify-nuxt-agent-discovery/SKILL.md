---
name: verify-nuxt-agent-discovery
description: "Verify a deployed Nuxt site running the nuxt-agent-discovery module, from a URL alone: markdown content negotiation, Vary and Link headers, the raw markdown route, discovery documents, the llms.txt bridge, agent error bodies and a full page sweep. Use after migrating a site to the module, when asked to test a preview deployment, or to check markdown negotiation on a deployed site."
---

# nuxt-agent-discovery deployment check

Check a deployed site running [`nuxt-agent-discovery`](https://github.com/benjamincanac/nuxt-agent-discovery), usually a preview deployment of the PR that adopts or bumps the module.

**Everything here runs against the URL.** The deployment is the subject: no repo, no local build, no config file is required. The site's shape is discovered by probing it. Where a repo happens to be at hand, use it to confirm a finding, never as the source of truth, since what shipped is what matters.

`Vary`, `Link` and the CDN rewrites only exercise properly through a real edge, which is why this is not a local test.

Report findings, don't fix anything.

## Inputs

The URL comes from the skill argument or the conversation. Ask when it is missing.

```sh
PREVIEW=            # the deployment under test
```

Shell setup:

```sh
BOT='ClaudeBot/1.0 (+https://anthropic.com/claudebot)'
GPT='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'
BROWSER='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
HTML='text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'

probe() { curl -sS -D - -o /dev/null "$@"; }      # headers only
show()  { curl -sS -D - "$@" | head -60; }        # headers plus the top of the body
```

## Ground rules

- Never pass `-L`. Redirects are part of what's under test.
- Absolute URLs inside markdown bodies point at the site's configured `siteUrl`, which is production, not the preview host. That is by design and it is also how Step 1 finds the production URL.
- If the deployment answers 401 with a Vercel SSO page, ask for a protection bypass token and send it as `-H "x-vercel-protection-bypass: <token>"`, or stop and say so.
- The CDN caches. When a result looks stale, re-run with a `?cb=1` query and note whether behaviour changed.
- Every failure gets a copy-pasteable curl repro and a call on whether it belongs to the site or to the module.

## Step 1: profile the deployment

Everything the later steps need comes out of the deployment itself.

```sh
probe "$PREVIEW/"                                        # host, headers, Link
curl -sS "$PREVIEW/llms.txt" | head -30
curl -sS "$PREVIEW/sitemap.md" | head -30
curl -sS "$PREVIEW/.well-known/api-catalog" | jq .
```

Establish and write down:

- **Host.** `x-vercel-id` means Vercel, where negotiation happens at the edge from the Build Output route table and everything in this skill applies. Anything else means only the Nitro middleware runs, and Nitro serves prerendered files ahead of user handlers, so **a prerendered page keeps returning HTML to an agent**. That is a documented limitation, not a regression: expect negotiation on never-prerendered pages and on explicit `.md` URLs, and say so in the report.
- **The raw prefix.** Read it off the links in `sitemap.md`, which point at raw twins. `/raw` is the default, and every command below uses `$RAW` rather than assuming it:

```sh
# The longest common leading path of the twins, so a multi-segment prefix like
# `/docs/raw` survives. Stripping only the first segment would target `/docs`.
RAW=$(curl -sS "$PREVIEW/sitemap.md" | grep -oE '\]\(https?://[^)]+\.md' | sed 's|.*://[^/]*||' \
  | awk -F/ 'NR==1{n=NF; for(i=1;i<NF;i++) p[i]=$i; next} {if(NF<n) n=NF; for(i=1;i<n;i++) if(p[i]!=$i){n=i; break}} END{s=""; for(i=2;i<n;i++) s=s "/" p[i]; print s}')
RAW=${RAW:-/raw}
echo "$RAW"
```
- **The production URL**, baked into every prerendered document by `siteUrl`:

```sh
PROD=$(curl -sS "$PREVIEW$RAW/index.md" | grep -oE 'https?://[^/)]+' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
echo "$PROD"
```

  Sanity-check it resolves to the live site. If it comes back as the preview host, the site resolves `siteUrl` per request rather than baking it, which is worth noting but not a fault.
- **The page inventory**, from `sitemap.xml`, falling back to `sitemap.md` or `llms.txt`:

```sh
curl -sS "$PREVIEW/sitemap.xml" | grep -o '<loc>[^<]*' | sed -E 's|<loc>||; s|https?://[^/]+||' | sort -u > /tmp/pages
wc -l /tmp/pages
```

- **Which documents exist**: `/sitemap.md`, `/robots.txt`, `/llms.txt`, `/llms-full.txt`, `/.well-known/api-catalog`, `/.well-known/mcp/server-card.json`, `/.well-known/skills/index.json`, any OpenAPI document linked from the api-catalog. A 404 on one of these means the feature is off, not that it is broken. Check the api-catalog and the `Link` header on `/` to see what the site claims to serve, then verify each claim.

Then pick concrete URLs from the inventory:

```sh
HOME=/
DOC=            # a deep documentation page
SECTION=        # a directory path with no page of its own, e.g. the parent of $DOC
UNCOVERED=      # a page in the inventory that does NOT negotiate, found in Step 2
```

Negotiation config is not readable over HTTP, so infer it: a page that answers markdown at its own URL sits under a rewrite, a page that 307s to its raw twin sits under a cached route rule (`isr`, `swr`, `cache`), and a page that stays HTML to an agent is not covered by any `routes` pattern. Step 3's sweep classifies every page this way, which is more reliable than reading the config anyway.

## Step 2: negotiation matrix

Run every row against `$HOME` and `$DOC`, plus one page from each class the sweep finds.

| Request | Expected |
|---|---|
| `probe -A "$BROWSER" -H "Accept: $HTML" "$PREVIEW$DOC"` | 200, `content-type: text/html`, `vary` contains `Accept` and `User-Agent` |
| `show -H 'Accept: text/markdown' "$PREVIEW$DOC"` | markdown body, `content-type: text/markdown`, 200 at the same URL (307 to the raw twin on a cached pattern, HTML on a non-Vercel host when the page is prerendered) |
| `show -A "$BOT" "$PREVIEW$DOC"` | same markdown, no `Accept` header needed |
| `probe -A "$GPT" "$PREVIEW$DOC"` | same as ClaudeBot |
| `show "$PREVIEW$DOC.md"` | markdown, 200, a rewrite even on a cached pattern |
| `probe -H 'Accept: text/markdown;q=0.5, text/html;q=0.9' "$PREVIEW$DOC"` | HTML **on an uncached pattern whose twin is not prerendered**, which is the only deterministic case: pick that `$DOC`. A CDN matcher cannot rank q-values, so a prerendered twin answers markdown at the edge and a cached pattern answers 307, both before the origin can rank anything. Documented in the README, not a bug |
| `probe -H 'Accept: text/markdown;q=0.9, text/html;q=0.5' "$PREVIEW$DOC"` | markdown |
| `probe -H 'Accept: text/markdown;q=0' "$PREVIEW$DOC"` | HTML |
| `probe -H 'Accept: */*' "$PREVIEW$DOC"` | HTML, a wildcard never counts as asking |
| `probe -H 'Accept: text/plain' "$PREVIEW$DOC"` | HTML, only `text/markdown` counts |
| `probe -A "$BOT" "$PREVIEW$UNCOVERED"` | HTML, an unconfigured page must not start negotiating |
| `probe -A "$BOT" "$PREVIEW$DOC?ref=x"` | markdown, and if it is a 307 the `location` keeps `?ref=x` |
| `probe -A "$BOT" -I "$PREVIEW$DOC"` | same status and headers as the GET. `-I`, not `-X HEAD`, which makes curl wait for a body that never comes |

Two things that fail quietly, so check them explicitly:

- **`Vary: Accept, User-Agent` is present on the markdown responses too**, including the ones served straight off the CDN rewrite. This is the `continue: true` fix most hand-rolled implementations get wrong. A markdown response with no `Vary` poisons the shared cache for browsers.
- **The three markdown representations are byte-identical.**

```sh
curl -sS -H 'Accept: text/markdown' "$PREVIEW$DOC" > /tmp/a.md
curl -sS "$PREVIEW$DOC.md" > /tmp/b.md
curl -sS "$PREVIEW$RAW${DOC}.md" > /tmp/c.md
diff /tmp/a.md /tmp/b.md && diff /tmp/b.md /tmp/c.md
```

## Step 3: sweep every page

The sample above proves the mechanism. This proves the coverage, and it is the only way to catch a page that failed to prerender, a subtree a `routes` pattern misses, or a document the adapter cannot stringify. Run it over the whole inventory, not a sample.

```sh
cat > /tmp/sweep.sh <<'EOF'
#!/bin/sh
p="$1"
agent=$(curl -sS -o /dev/null -w '%{http_code} %{content_type} %{redirect_url}' -A "$BOT" "$PREVIEW$p")
html=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' -A "$BROWSER" -H "Accept: $HTML" "$PREVIEW$p")
twin=$([ "$p" = "/" ] && echo skip || curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$PREVIEW${p%/}.md")
raw=$(curl -sS -o /dev/null -w '%{http_code}' "$PREVIEW$RAW$([ "$p" = "/" ] && echo /index || echo "${p%/}").md")
echo "$p | agent: $agent | html: $html | twin: $twin | raw: $raw"
EOF
chmod +x /tmp/sweep.sh
export PREVIEW BOT BROWSER HTML
xargs -P 8 -n 1 /tmp/sweep.sh < /tmp/pages > /tmp/sweep.txt
```

Then classify. Every line should fall into one of two shapes:

- **negotiated**: agent `200 text/markdown`, or `307` with a `redirect_url` at the raw twin
- **not negotiated**: agent `200 text/html`, and the page is genuinely outside the `routes` patterns

Everything else is a finding:

```sh
grep -v 'text/markdown' /tmp/sweep.txt | grep -v ' 307 '     # pages serving HTML to an agent
grep -v 'html: 200 text/html' /tmp/sweep.txt                  # pages broken for browsers
grep -v 'twin: 200 text/markdown\|twin: skip' /tmp/sweep.txt  # .md twins that 404
grep -v 'raw: 200' /tmp/sweep.txt                             # raw route holes
awk '{print $NF}' /tmp/sweep.txt | sort | uniq -c              # raw status distribution
```

A page that is HTML-only to agents is a finding when its neighbours negotiate, and expected when the site deliberately leaves that section out. Group them by prefix before deciding, and use one of them as `$UNCOVERED`.

Also sweep for empty or truncated documents, which return 200 and look fine:

```sh
while read -r p; do
  n=$(curl -sS "$PREVIEW$RAW$([ "$p" = "/" ] && echo /index || echo "${p%/}").md" | wc -c)
  [ "$n" -lt 200 ] && echo "THIN $n $p"
done < /tmp/pages
```

## Step 4: the raw route

- `show "$PREVIEW$RAW${DOC}.md"` returns 200, `text/markdown`, and a `Link` header with both `rel="canonical"` and `rel="alternate"; type="text/html"` pointing at the page URL.
- `probe "$PREVIEW$RAW${SECTION}.md"` returns 302 to the first document under that section, not a 404.
- `show "$PREVIEW$RAW/does-not-exist.md"` returns 404 with a markdown body.
- `curl -sS "$PREVIEW$RAW/index.md" | head -30` returns the homepage document, or the generated landing page: frontmatter, canonical and alternate links, and a resources block.
- Site-relative links are absolutised. Every `](/` outside a fenced block is a bug, across the whole inventory:

```sh
while read -r p; do
  curl -sS "$PREVIEW$RAW$([ "$p" = "/" ] && echo /index || echo "${p%/}").md" \
    | awk '/^ {0,3}(```|~~~)/{f=!f} !f' | grep -q '](/' && echo "RELATIVE $p"
done < /tmp/pages
```

  Read each match in context before reporting it. The scan skips fenced blocks but not inline code spans, so a page writing `](/x)` inside backticks is a false positive, and the module leaves those alone on purpose. Sites still running a hand-rolled layer do carry relative links here, so this check is expected to differ between production and the preview.

- Fenced blocks survived. Spot-check a page documenting markdown or MDC and confirm nothing inside a fence was rewritten.
- Markdown structure survived the stringifier: pick five pages with tables, callouts, nested lists, code groups and frontmatter, and read them. A component that stringified to nothing leaves a 200 with a hole in it.

## Step 5: discovery documents

```sh
show "$PREVIEW/"                               # Link header lives on / only
curl -sS "$PREVIEW/.well-known/api-catalog" | jq .
curl -sS "$PREVIEW/.well-known/mcp/server-card.json" | jq .
curl -sS "$PREVIEW/sitemap.md" | head -40
curl -sS "$PREVIEW/.well-known/skills/index.json" | jq .
curl -sS "$PREVIEW/robots.txt"
```

- The `Link` header on `/` carries only IANA-registered rels. Any `rel="llms"`, `rel="mcp"`, `rel="design"` or other invented relation means something outside the module is emitting headers, since the module rejects them at build time.
- Every href in the `Link` header and the api-catalog resolves. Fetch each one and record the status.
- `api-catalog` answers `application/linkset+json`, parses, and every `anchor` and `href` is absolute.
- The server card carries `serverInfo.name` and an `endpoints` array (`endpoint` and `name` are the config keys, not the served fields), and lists live tools where the site runs `@nuxtjs/mcp-toolkit`. The endpoint it names answers: POST an MCP `initialize` to it. There is no `$schema`: the MCP spec has no server card yet.
- `sitemap.md` links point at a raw twin for every page a `routes` pattern covers. A page outside those patterns correctly links to its HTML URL, and a path under `excludePrefixes` is left out entirely, so compare against the negotiated set rather than against `sitemap.xml`.
- The skills index lists skills, and every file it names fetches 200:

```sh
# Fail loudly when the index itself is missing: an empty pipeline below would
# otherwise report a clean pass on a site that serves no index at all.
if ! curl -fsS "$PREVIEW/.well-known/skills/index.json" > /tmp/skills.json; then
  echo 'FAIL: no skills index'   # a finding whenever the site ships skills
else
  jq -r '.skills[] | .name as $n | .files[] | "\($n)/\(.)"' /tmp/skills.json \
    | while read -r p; do printf '%s %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' "$PREVIEW/.well-known/skills/$p")" "$p"; done
fi
```

- `robots.txt` names the agents negotiation actually matches. Cross-check it: every user agent named there gets markdown on `$DOC`, and the list is not shorter than the 18 defaults unless the site replaced it.

## Step 6: the nuxt-llms bridge

`/llms.txt` and `/llms-full.txt` stay owned by `nuxt-llms`. The module only feeds them.

```sh
curl -sS -D - -o /tmp/llms.txt "$PREVIEW/llms.txt" | head -5
curl -sS -o /tmp/llms-full.txt "$PREVIEW/llms-full.txt"
wc -c /tmp/llms.txt /tmp/llms-full.txt
grep -oE '\]\([^)]+\)' /tmp/llms.txt | grep -v '\.md)' | head       # same-origin links that missed the raw rewrite
```

- Both answer 200 as plain text at their existing paths.
- Every same-origin link in `llms.txt` points at its raw twin, hand-written links included, and every one of them resolves.
- The link set matches the inventory. A section that lost its links, or a page that fell out, is a finding:

```sh
# The homepage is `/` in the sitemap and `/index` in a raw twin, so both sides
# are folded to `/` before the diff. Without that a correct site reports one.
home() { sed -e 's|^/index$|/|' -e 's|^$|/|' -e 's|\(.\)/$|\1|' | sort -u; }
grep -oE 'https?://[^)]+\.md' /tmp/llms.txt | sed "s|.*$RAW||;s|\.md$||" | home > /tmp/llms-pages
diff <(home < /tmp/pages) /tmp/llms-pages | head -40
```

- A page's body inside `llms-full.txt` is byte-identical to the **body** of `/raw/<page>.md`, which is that document minus its frontmatter block and its `## Sitemap` footer. They come from one pipeline now, so any difference beyond that envelope is a bug. Check three pages from different sections.

## Step 7: error bodies

| Request | Expected |
|---|---|
| `show -A "$BOT" "$PREVIEW/nope"` | 404, `text/markdown`, frontmatter with `title` and `status`, recovery links absolute and resolving |
| `probe -A "$BROWSER" -H "Accept: $HTML" "$PREVIEW/nope"` | 404 HTML error page |
| `probe -H 'Accept: */*' -H 'Sec-Fetch-Mode: cors' "$PREVIEW/nope"` | not markdown, a browser `fetch()` keeps what it was written against |
| `probe -H 'Accept: application/json' "$PREVIEW/api/does-not-exist"` | JSON error, never markdown |
| `probe -A "$BOT" "$PREVIEW/_nuxt/nope.js"` | not markdown |
| `probe -A "$BOT" "$PREVIEW/nope.png"` | not markdown, a dotted path is an asset |
| `curl -sS "$PREVIEW/nope"` | markdown, plain curl with no `Accept` counts as an agent |
| `probe -A "$BOT" "$PREVIEW/nope/deeper/still"` | 404 markdown, not a redirect loop |

The 404 must be a real 404. A 200 carrying the app shell tells every agent that every path exists.

## Step 8: no collateral damage

- `/sitemap.xml` is XML, resolves, and does not list a single raw URL: `curl -sS "$PREVIEW/sitemap.xml" | grep -c '/raw/'` must print 0.
- Assets are untouched: a favicon, an og-image, a `_payload.json`, anything dotted under a negotiated pattern.
- The site's own endpoints answer. Enumerate them from the HTML the app ships (`grep -o '/api/[a-z0-9./-]*'` over a rendered page) and from the api-catalog, then fetch each one.
- Any OpenAPI document parses and its `paths` are populated:

```sh
curl -sS "$PREVIEW/openapi.json" | jq -r '.paths | keys[]' | head -40
```

- A doc page's head still carries its canonical, alternate, og and JSON-LD tags. `useCanonical()` moving from a site file into the module is exactly how a trailing slash, a locale alternate or an og tag goes missing:

```sh
curl -sS -A "$BROWSER" -H "Accept: $HTML" "$PREVIEW$DOC" \
  | grep -oE '<(link|meta|script)[^>]*(canonical|alternate|og:|ld\+json)[^>]*>'
```

- The rendered HTML carries real content, not just an app shell: an `<h1>` and a few hundred characters of text before hydration.
- If a browser tool is available (Playwright, a devtools MCP), load three pages and check for console errors and hydration mismatches. Say so in the report when no browser was available.

## Step 9: production diff

`$PROD` came out of Step 1. Skip this when it resolves to the same deployment, or when production already runs the same module version.

When production still runs a prior implementation, this is the strongest check available. Diff a sample of at least ten pages spread across sections, rewriting hosts so only content differences remain.

```sh
for p in $(awk 'NR % 18 == 1' /tmp/pages); do        # every 18th page, spread across the inventory
  curl -sS "$PROD/raw${p%/}.md"    | sed "s|$PROD||g" > /tmp/prod.md
  curl -sS "$PREVIEW$RAW${p%/}.md" | sed "s|$PREVIEW||g;s|$PROD||g" > /tmp/prev.md
  echo "== $p"; diff /tmp/prod.md /tmp/prev.md || true
done
```

Do the same for `/llms.txt`, `/sitemap.md`, `/robots.txt`, `/.well-known/api-catalog`, the head tags from Step 8, and the page inventory:

```sh
curl -sS "$PROD/sitemap.xml" | grep -o '<loc>[^<]*' | sed -E 's|<loc>||; s|https?://[^/]+||' | sort -u > /tmp/prod-pages
diff /tmp/prod-pages /tmp/pages | head -40
comm -23 <(curl -sS "$PROD/openapi.json" | jq -r '.paths|keys[]' | sort) \
         <(curl -sS "$PREVIEW/openapi.json" | jq -r '.paths|keys[]' | sort)
```

Differences worth accepting: prose the PR intentionally changed, links that were relative before and are absolute now, and MDC output the adapter renders differently on purpose. Everything else is a regression: a dropped page, a lost frontmatter field, a mangled fence, a table rendered as prose, a code block that lost its language, a component that stringified to nothing, an API path that disappeared.

## Step 10: is-agentic score

[`is-agentic`](https://github.com/vercel-labs/is-agentic) (Vercel Labs) scores agent readiness.

```sh
npx -y is-agentic "$PREVIEW" --json > /tmp/is-agentic-preview.json
npx -y is-agentic "$PROD"
```

The preview score must be at least production's, and no check may move from pass to fail. Report the delta and the named checks that changed.

Two caveats to state rather than work around:

- It is a hosted scanner. The URL is submitted to `is-agentic.com`, which keeps the report and can serve it to anyone asking for that domain. Ask before scanning a preview of unreleased work.
- It probes with browser-ish headers, so a check can come back partial on a site that handles agents correctly. Its "Agent-friendly 404s" check reads a browser 404, not the markdown body an agent gets. Reproduce a partial by hand before reporting it.

## Optional: the build output table

Only when the repo is at hand and something in Step 2 or 3 looked structurally wrong. Build with the vercel preset and read `.vercel/output/config.json`:

```sh
jq '.routes | length' .vercel/output/config.json
jq '.routes[0:6]' .vercel/output/config.json
```

- The first route sets `Vary: Accept, User-Agent` with `continue: true`, ahead of anything Nitro emits from `routeRules`. The `Link` route on `/` does too.
- Two negotiated routes per configured pattern, one matching `Accept`, one matching the agent user agents. Prerendered patterns rewrite with `check: true`, cached patterns 307.
- Total route count tracks the pattern count, not the page count.

## What this does not cover

Say so in the report rather than implying full coverage:

- Anything behind auth, and anything the CDN serves differently to a real bot IP than to curl.
- Content or schema changes whose effect shows up only in search indexes, navigation payloads or component metadata that the sweep does not fetch.
- Visual regressions, and client-side behaviour beyond console errors when a browser tool was available.
- Performance, cold starts and function count.

## Attributing a finding

Every finding lands in one of two repos, and the fix is different in each. Attribute before reporting, and say which evidence you used.

**Rule of thumb.** The site owns its configuration, its content and its hooks. The module owns behaviour no configuration can change. So: a whole section that never negotiates is a `routes` pattern, a single page whose table came out mangled is content or an adapter, and a missing `Vary` on a CDN rewrite is the module, because no site config can produce or prevent it.

| Symptom | Likely owner | Confirm by |
|---|---|---|
| No `Vary` on a markdown response, or none on `/` | module, `src/presets/vercel.ts` | check the site does not override headers for that path in `routeRules` |
| `text/plain` or `q=0` decided wrong, wildcard treated as asking | module, `src/runtime/shared/negotiation.ts` | a unit test in the module's `test/`, it is pure logic |
| A whole section serves HTML to agents | site, `routes` patterns | does the pattern actually cover it? if it plainly does, the module's `compilePattern`/`matchRoute` |
| `.md` twin 404s while `/raw/**.md` answers | module, `rawDestination` or the preset rewrite | unless an `excludePrefixes` entry on the site swallows that path |
| A standalone `.md` the site serves itself got rewritten | site, add it to `excludePrefixes` | |
| Invented `rel` in the `Link` header | site, something outside the module emits it | the module validates rels at build time and throws |
| A discovery link missing from the api-catalog | site, `discovery.links` | only `service-desc` and `service-doc` entries carrying an `anchor` are grouped, by design |
| Mangled table, dropped component, lost code language | site content, its MDC transform, or its `agent-discovery:document` hook | reproduce the same construct on the module playground; if it breaks there too it is the stringifier in `src/runtime/server/sources/content.ts` |
| Relative links left in a raw document | module, `absolutizeMarkdownLinks` | unless the site ships a custom adapter, which has to call it itself |
| Section URL 404s instead of redirecting to its first page | module `firstLeaf` handling, or the site's adapter not implementing `firstLeaf` | which source the site configures |
| Agent gets an HTML 404, or a browser gets markdown | module, `src/runtime/server/error.ts` | unless the site chained its own `errorHandler` after the module's |
| `llms.txt` links not pointing at raw twins | module, the llms bridge plugin | unless the site sets its own `llms:generate` hooks or `contentRawMarkdown` |
| `robots.txt` short on agents | site, `userAgents.replace` or `@nuxtjs/robots` config | compare with the module's 18 defaults |
| `sitemap.xml` listing raw URLs | module, the `@nuxtjs/sitemap` exclude | unless the site configures its own `sitemap.exclude` |
| A cached page serving mixed variants | module, cached-route detection | which `routeRules` the site added, and whether the pattern overlaps |

**Three ways to settle a doubtful one:**

1. **Second deployment.** If another site running the same module version shows the same failure, it is the module. If only this deployment shows it, it is the site.
2. **The playground.** The module repo's `pnpm dev` serves a minimal fixture on `localhost:3000`. Send the same headers. A failure that reproduces there is the module's, on a site whose config you control.
3. **A failing test.** The negotiation core is pure and unit-tested in the module's `test/`. For any decision bug (`Accept` parsing, pattern matching, exclusions, error preference) write the case as a test rather than arguing from a curl. That test is the deliverable.

Never push a fix to either repo from this skill. Hand back the finding and, for the module, the test that proves it.

## Report

Give, in this order:

1. A one-line verdict: ship, or blocked.
2. A table of every step with pass, fail or n/a, and the sweep counts: pages checked, negotiated, HTML-only, twin failures, raw failures.
3. **Findings for the site PR**, each with: what broke, the curl repro, the config or content line to change, and the evidence for attributing it here.
4. **Findings for the module**, each with: what broke, the curl repro, the invariant it violates, the file that owns it, and a test case that would fail today. Write these so they paste into the module repo as an issue body without editing.
5. Differences judged intentional, so the user can confirm the call.
6. What could not be checked and why.

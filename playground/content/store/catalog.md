---
title: Catalog
description: A page the CDN caches through `Cache-Control`, not ISR.
---

This page is rendered by the server and cached on the CDN for two minutes through its `Cache-Control` header. An agent asking for markdown is redirected to the raw twin before the cache is read.

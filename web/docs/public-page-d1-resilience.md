# Public-page D1 resilience

## 2026-09-28 incident

Four public requests returned HTTP 500 between 09:13 and 15:55 UTC: three
requests to `/` and one to `/talent/mwangie29`. Invocation-level Cloudflare
Worker telemetry ties every response to the same database failure:

```text
D1_ERROR: D1 DB is overloaded. Requests queued for too long.
```

The three homepage failures originated in `listPublicPosts`. The profile
failure originated in the published-profile lookup. The Worker outcome was
`ok` because Astro converted each render exception into an HTTP 500 response.
The request middleware attempted to record every exception, but each
`errorEvent` write immediately encountered the same D1 overload. That second
failure explains why the database ledger contained no matching rows even
though Worker logs contained the render exceptions.

Cloudflare D1 is single-threaded per database. It queues concurrent operations
and returns this overload after requests remain queued for too long. D1 already
automatically retries retryable read-only queries, so these events survived the
platform's built-in read retries.

## Application behavior

Public routes degrade only for the two confirmed D1 overload messages. Other
database and application failures still propagate through the request error
boundary.

- `/` treats recent posts as optional and renders the rest of the homepage with
  HTTP 200 when that read is overloaded.
- `/talent/:handle` cannot safely distinguish a published profile from a
  missing one without its required reads. It renders an explicit HTTP 503 page
  with `Retry-After: 30` and `Cache-Control: no-store`; it does not mislabel the
  profile as unpublished.
- Caught overloads enter the same redacted `errorEvent` path with the stable
  route `/talent/:handle` or `/`. Error writes run under the Cloudflare request
  execution context and retry only the confirmed overload condition with
  bounded backoff.
- The middleware error boundary includes authentication and route guards and
  records an explicit HTTP 500 response even when downstream code returns it
  instead of throwing.

# Community profiles and work

See [member visibility and work storage](../members/README.md) for the shared read and moderation rules.

`service.ts` owns the community REST, tools and MCP operations; writing callers must supply moderation bindings. Read-only counts expose a separate service. Tokens with `community:read` use the same signed-in member view. Institution-only AI tools keep their capability gate.

A contribution's evidence revision belongs to its confirmations and private mentor set-asides. Posting or drafting unchanged text retains that revision. Repository reorder and snapshot refresh retain it when evidence text is unchanged. Admin takedowns survive owner deletion of repository work.

# Born-Secure Checklist
- [ ] Lockfile committed from day one
- [ ] No plaintext secrets — `.env` gitignored, values in 1Password (`op://`)
- [ ] Dependency cooldown inherited from global config (IT-18)
- [ ] CI permissions scoped: `permissions: contents: read`
- [ ] Third-party Actions SHA-pinned (`pinact run`)

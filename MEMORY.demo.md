# Project Memory

## Project Background

- [mem_1785726280841_2qjrbo] Mini-CRM: a lightweight user management service with auth, persistence, and HTTP handlers.

## Architecture Decisions

- [mem_1785726280842_3jm1ap] Auth module uses bcrypt for password hashing. Repo layer uses PostgreSQL via Drizzle ORM.
  [conf:0.90]

## Verified Facts

- [mem_1785726280843_dozkgp] saveUser should accept an optional transaction parameter for atomicity
  [conf:0.85]

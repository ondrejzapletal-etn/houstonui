# Repository Instructions

This repository implements Houston NextGen.

Always follow:
- secure by default,
- privacy by design,
- explicit permissions,
- audit everything,
- server-side agent execution,
- backend-mediated LLM access,
- no secrets in desktop,
- no unsafe automation.

Do not introduce new frameworks, cloud services or storage technologies without adding an ADR in `/docs/decisions`.

When generating code:
- use TypeScript strictly,
- prefer explicit types,
- avoid `any`,
- validate DTOs,
- write tests,
- keep functions small,
- separate UI, application logic, domain logic and infrastructure.
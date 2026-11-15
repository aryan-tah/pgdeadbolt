# Security policy

## Supported versions

Security fixes go into the latest release.

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately through GitHub: **Security → Report a vulnerability** on this repository. You'll get an acknowledgement within three days.

pgdeadbolt reads migration files and, in rehearsal mode, connects to a database you point it at. Things worth reporting include anything that makes it run SQL you didn't intend, leak connection details, or write outside the rehearsal database.

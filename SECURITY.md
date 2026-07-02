# Security Policy

DJUI is a local development tool for StarEngine 2.0 UI workflows. The backend can browse local directories and copy files into user-selected projects, so it should not be exposed to untrusted networks.

## Supported Versions

The public project is currently pre-1.0. Security fixes are applied to the latest `main` branch until a stable release policy is published.

## Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories when the repository is available. If private reporting is not available yet, contact the maintainer directly.

Do not include real tokens, private paths, or proprietary assets in public issues.

Useful details:

- Operating system
- DJUI commit or release version
- Node.js version
- Reproduction steps
- Whether the backend was bound to `127.0.0.1` or `0.0.0.0`

## Security Boundaries

By default DJUI listens on `127.0.0.1`, restricts CORS to local origins, and treats `editor/backend/djui_config.json` as local-only state. See [docs/security.md](docs/security.md) for details.

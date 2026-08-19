# Security Policy

DJUI is a purely client-side editor for StarEngine 2.0 UI workflows. All file access goes through the browser File System Access API with explicit user directory grants; there is no backend service. Deployed builds are static files only.

## Supported Versions

The public project is currently pre-1.0. Security fixes are applied to the latest `main` branch until a stable release policy is published.

## Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories when the repository is available. If private reporting is not available yet, contact the maintainer directly.

Do not include real tokens, private paths, or proprietary assets in public issues.

Useful details:

- Operating system
- DJUI commit or release version
- Browser and version
- Reproduction steps
- Which directories were granted to the editor

## Security Boundaries

The editor can only read and write directories the user explicitly granted through the browser. Builds are static assets with no server-side logic, environment variables, or secrets. See [docs/security.md](docs/security.md) for details.

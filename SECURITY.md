# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Finchippay-Solution, please report it privately to the maintainers.

**Do not open a public issue.** Instead, email the team with details.

## Vulnerability Management Process

1. **Reporting**: Vulnerability reported privately via email
2. **Triage**: Maintainers assess severity within 48 hours
3. **Fix**: Patch developed and tested
4. **Disclosure**: Public advisory published after fix is deployed

## Dependency Scanning

- **npm audit** runs on every PR for frontend and backend (--audit-level=high)
- **cargo audit** runs on every PR for the Soroban contract
- **Dependabot** opens weekly PRs for npm and cargo dependency updates
- **Weekly security audit** workflow runs on schedule (.github/workflows/security-audit.yml)

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < 1.0   | :x:                |

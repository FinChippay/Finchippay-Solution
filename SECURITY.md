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
- **Grype** scans generated SBOMs on every build and **fails CI on CRITICAL/HIGH**
  vulnerabilities (.github/workflows/ci.yml, `SBOM & Vulnerability Scan` job)
- **Trivy** scans backend and frontend container images before they are pushed to
  ghcr.io; a CRITICAL/HIGH finding blocks the publish (.github/workflows/docker-publish.yml)
- **Dependabot** opens weekly PRs for npm and cargo dependency updates
- **Weekly security audit** workflow runs on schedule (.github/workflows/security-audit.yml)
- **Weekly SBOM scan** regenerates SBOMs, scans them, and opens a tracking issue on
  new CRITICAL vulnerabilities (.github/workflows/sbom-scan.yml)

## Software Bill of Materials (SBOM)

Finchippay publishes a Software Bill of Materials for supply-chain transparency and
compliance (e.g. U.S. Executive Order 14028).

- **Formats**: both **SPDX** (`*.spdx.json`) and **CycloneDX** (`*.cdx.json`).
- **Components covered**: frontend (npm), backend (npm), Soroban contract (cargo),
  and the published backend/frontend container images.
- **Availability**:
  - Attached as **assets to every [GitHub Release](../../releases)**.
  - Uploaded as **build artifacts** on every CI run (`sboms` artifact) and on the
    weekly SBOM scan (retained 90 days).
- **Generate locally**: install [syft](https://github.com/anchore/syft), then run
  `make sbom` — SBOMs are written to the `sbom/` directory. Run `make sbom-scan`
  to additionally scan them with [grype](https://github.com/anchore/grype).
- **Requesting an SBOM**: download the latest release assets above, or email the
  maintainers if you need an SBOM for a specific version or build.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < 1.0   | :x:                |

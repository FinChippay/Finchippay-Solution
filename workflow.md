# Workflow for Issue #110: Contributors Onboarding Guide and Dev Environment Setup

This document outlines the steps to address Issue #110, focusing on creating a comprehensive contributor onboarding guide and an automated development environment setup script.

## 1. Enhance `scripts/setup-dev.sh`

**Objective:** Automate the setup of the development environment.

**Steps:**

1.  **Prerequisite Checks and Installation:**
    - Add checks for Node.js (20+), Rust, Docker, and Stellar CLI.
    - Provide instructions or automated installation for missing prerequisites where feasible (e.g., `rustup`, `nvm` for Node.js).
    - Include a link to the Freighter extension for manual installation.
2.  **Clone and Setup Services:**
    - Ensure the script can clone necessary repositories (if applicable, based on project structure).
    - Integrate `docker compose -f docker-compose.dev.yml up` to start all services.
3.  **Verify Environment:**
    - Add commands to run all tests (unit, integration, E2E) to confirm a successful setup.

## 2. Write `docs/CONTRIBUTOR_GUIDE.md`

**Objective:** Create a comprehensive guide for new contributors.

**Steps:**

1.  **Architecture Overview:**
    - Summarize the three-layer architecture.
    - Include diagrams (referencing existing `docs/architecture.md` or creating new ones if needed).
2.  **Development Environment Setup:**
    - Provide clear instructions on how to use `setup-dev.sh`.
    - Explain manual setup steps if `setup-dev.sh` cannot cover everything.
3.  **Project Structure Tour:**
    - Describe the main directories and their contents.
    - Explain the purpose of key files.
4.  **How to Run Tests:**
    - Detail how to run unit, integration, and E2E tests.
    - Specify commands and expected outcomes.
5.  **PR Workflow and Code Review Expectations:**
    - Outline the process for submitting pull requests.
    - Describe code review guidelines and expectations.
6.  **How to Find Good First Issues:**
    - Guide contributors on identifying suitable entry-level tasks.
7.  **Troubleshooting Common Issues:**
    - Compile a list of frequently encountered problems and their solutions.

## 3. Add `.vscode/` Configuration

**Objective:** Provide a consistent and efficient development experience for VS Code users.

**Steps:**

1.  **Recommended Extensions:**
    - Create `.vscode/extensions.json` to suggest relevant extensions (e.g., Rust Analyzer, Docker, ESLint, Prettier).
2.  **Launch Configurations:**
    - Create `.vscode/launch.json` with configurations for debugging the frontend and backend services.

## 4. Create `docker-compose.dev.yml`

**Objective:** Enable one-command startup for all development services.

**Steps:**

1.  **File Creation:**
    - Create `docker-compose.dev.yml` in the project root if it doesn't exist.
2.  **Service Definitions:**
    - Define all necessary services for local development (e.g., database, backend, frontend, Stellar testnet).
    - Ensure proper port mappings, volume mounts, and environment variables.

## 5. Verification

**Objective:** Ensure all acceptance criteria are met.

**Steps:**

1.  Run `bash scripts/setup-dev.sh` and confirm it sets up the full dev environment without errors.
2.  Review `CONTRIBUTOR_GUIDE.md` to ensure all specified sections are covered comprehensively.
3.  Run `docker compose -f docker-compose.dev.yml up` and verify all services start correctly.
4.  Open the project in VS Code and confirm recommended extensions are suggested and launch configurations are available and functional for debugging.

## Notes

- Prioritize using existing documentation (`CONTRIBUTING.md`, `docs/architecture.md`) and scripts as a base.
- Ensure all instructions are clear, concise, and easy to follow for a new contributor.
- Use relative paths where appropriate within the documentation.
- Consider adding a section on code style and linting if not already covered elsewhere.

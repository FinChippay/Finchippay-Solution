# Contributor Onboarding Guide for Finchippay Solution

Welcome to the Finchippay Solution project! This guide will help you get started with setting up your development environment, understanding the project's architecture, contributing code, and navigating our development practices.

## 1. Architecture Overview

Finchippay Solution follows a three-layer architecture designed for scalability, maintainability, and clear separation of concerns.

- **Frontend**: Built with React, this layer provides the user interface and interacts with the backend API.
- **Backend**: Developed using Node.js (Express.js), this layer handles business logic, data processing, and API endpoints. It communicates with the database and external services.
- **Smart Contracts**: Written in Rust, these contracts run on the Stellar blockchain, managing core financial logic and transactions.

For a more detailed understanding, please refer to [docs/architecture.md](architecture.md).

## 2. Development Environment Setup

We provide a one-command setup script to get your development environment ready quickly.

### Prerequisites

Before running the setup script, ensure you have the following installed:

- **Git**: For cloning the repository.
- **Node.js (v20 or higher)**: For frontend and backend development. We recommend using `nvm` (Node Version Manager) for easy version management.
- **Rust**: For smart contract development. Install `rustup` from [https://rustup.rs](https://rustup.rs).
- **Docker Desktop**: For running services like databases and the Stellar testnet. Download from [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/).
- **Stellar CLI**: For interacting with the Stellar network. Follow the installation guide: [https://developers.stellar.org/docs/getting-started/setup-local-development#install-the-stellar-cli](https://developers.stellar.org/docs/getting-started/setup-local-development#install-the-stellar-cli).
- **Freighter Wallet Extension**: A browser extension for interacting with Stellar applications. Install from [https://freighter.app](https://freighter.app).

### Automated Setup with `scripts/setup-dev.sh`

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-org/finchippay-solution.git
    cd finchippay-solution
    ```
2.  **Make the setup script executable**:
    ```bash
    chmod +x scripts/setup-dev.sh
    ```
3.  **Run the setup script**:
    ```bash
    ./scripts/setup-dev.sh
    ```
    This script will:
    - Check for required tools (Node.js, Rust, Docker, Stellar CLI).
    - Install Node.js and backend dependencies.
    - Bring up the Docker Compose development environment (database, Stellar testnet, etc.).
    - Run initial tests to verify your setup.

### Manual Setup (if needed)

If the automated script encounters issues or you prefer a manual approach:

1.  **Install Node.js dependencies**:
    ```bash
    cd frontend
    npm install
    cp .env.example .env.local # if not already present
    cd ../backend
    npm install
    cp .env.example .env # if not already present
    ```
2.  **Install Rust toolchain and target**:
    ```bash
    rustup toolchain install stable
    rustup target add wasm32-unknown-unknown --toolchain stable
    ```
3.  **Start Docker Compose services**:
    ```bash
    cd finchippay-solution # (project root)
    docker compose -f docker-compose.dev.yml up -d --build
    ```

## 3. Project Structure Tour

The project is organized into several key directories:

- `backend/`: Contains the Node.js backend application.
  - `src/`: Backend source code.
  - `tests/`: Backend unit and integration tests.
- `frontend/`: Contains the React frontend application.
  - `src/`: Frontend source code.
  - `public/`: Static assets.
  - `tests/`: Frontend unit and integration tests.
- `contracts/`: Stellar smart contracts written in Rust.
- `docs/`: Project documentation, including this guide and architecture details.
- `scripts/`: Utility scripts, including `setup-dev.sh`.
- `.vscode/`: VS Code specific configurations (extensions, launch settings).
- `docker-compose.dev.yml`: Docker Compose configuration for the development environment.

## 4. How to Run Tests

Maintaining a robust test suite is crucial. Here's how to run different types of tests:

### Unit and Integration Tests

- **Frontend**:
  ```bash
  cd frontend
  npm test
  ```
- **Backend**:
  ```bash
  cd backend
  npm test
  ```
- **Smart Contracts**:
  ```bash
  cd contracts
  cargo test
  ```

### End-to-End (E2E) Tests

(Instructions for E2E tests will go here once implemented, e.g., using Cypress or Playwright)

## 5. PR Workflow and Code Review Expectations

We follow a standard GitHub Flow for contributions:

1.  **Fork the repository** and clone it locally.
2.  **Create a new branch** for your feature or bug fix: `git checkout -b feature/my-new-feature` or `git checkout -b bugfix/fix-login-issue`.
3.  **Make your changes**, ensuring they adhere to our [code style guidelines](#code-style-and-linting).
4.  **Write tests** for your changes.
5.  **Run all tests** locally to ensure nothing is broken.
6.  **Commit your changes** with clear and concise commit messages.
7.  **Push your branch** to your forked repository.
8.  **Open a Pull Request (PR)** to the `main` branch of the upstream repository.
    - Provide a clear title and detailed description of your changes.
    - Reference any related issues (e.g., `Fixes #123`).
9.  **Address code review feedback** promptly. We aim for constructive feedback to improve code quality.
10. **Once approved**, your PR will be merged.

### Code Review Expectations

- **Readability**: Code should be easy to understand.
- **Maintainability**: Changes should be easy to extend and modify in the future.
- **Test Coverage**: New features and bug fixes should be accompanied by appropriate tests.
- **Performance**: Be mindful of performance implications.
- **Security**: Adhere to security best practices.

## 6. How to Find Good First Issues

If you're new to the project, look for issues labeled `good first issue` or `help wanted` in our [issue tracker](https://github.com/your-org/finchippay-solution/issues). These issues are typically well-defined and less complex, making them ideal for new contributors.

## 7. Troubleshooting Common Issues

- **Docker containers not starting**:
  - Ensure Docker Desktop is running.
  - Check Docker logs for specific error messages: `docker compose logs`.
  - Try rebuilding containers: `docker compose -f docker-compose.dev.yml up -d --build --force-recreate`.
- **Node.js version conflicts**:
  - Use `nvm use 20` to switch to the correct Node.js version.
- **`npm install` failures**:
  - Clear npm cache: `npm cache clean --force`.
  - Delete `node_modules` and `package-lock.json` (or `yarn.lock`) and try `npm install` again.
- **Rust compilation errors**:
  - Ensure `wasm32-unknown-unknown` target is installed: `rustup target add wasm32-unknown-unknown`.
  - Update Rust toolchain: `rustup update`.

## 8. VS Code Configuration

We recommend using Visual Studio Code for development. Our `.vscode/` directory contains configurations to enhance your development experience:

- **Recommended Extensions**: When you open the project, VS Code should suggest installing recommended extensions (e.g., ESLint, Prettier, Docker, Rust Analyzer).
- **Launch Configurations**: `launch.json` provides configurations for debugging the frontend and backend directly from VS Code.

---

Thank you for contributing to Finchippay Solution! We appreciate your efforts.

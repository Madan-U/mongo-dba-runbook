<div align="center">

# mongodb-scripts

**A curated collection of scripts and utilities for MongoDB administration.**
Organised, reusable, and version-controlled — in one repository.

![MongoDB](https://img.shields.io/badge/MongoDB-scripts-47A248?logo=mongodb&logoColor=white)
![Shell](https://img.shields.io/badge/Shell-Bash-4EAA25?logo=gnubash&logoColor=white)
![JavaScript](https://img.shields.io/badge/mongosh-JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Status](https://img.shields.io/badge/status-active%20development-orange)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## Overview

`mongodb-scripts` is a central place to store, version, and share MongoDB-related scripts used by DBA and operations teams. The goal is simple: keep everything **organised, reusable, and easy to find**.

Every script is documented at the top with its purpose, parameters, and prerequisites, so anyone on the team can pick it up and run it with confidence.

## Key Features

| Area | Capability |
|---|---|
| **Organised Layout** | Scripts grouped by category so they are easy to browse and maintain |
| **Self-Documented** | Each script carries a header describing purpose, usage, and required privileges |
| **Reusable** | Parameterised scripts that work across environments, with no hardcoded values |
| **Version Controlled** | Full change history and review through pull requests |
| **Safe by Default** | Read-only operations preferred; anything destructive is clearly labelled |

## Repository Structure

```text
mongodb-scripts/
├── scripts/        # MongoDB scripts, grouped by category
├── docs/           # Notes and reference documentation
└── README.md
```

> Add folders and categories as the collection grows.

## Getting Started

### Prerequisites

- MongoDB Shell (`mongosh`) and/or MongoDB Database Tools
- Network access to the target MongoDB deployment
- Required access and privileges for the script being run

### 1. Clone the repository

```bash
git clone https://github.com/Madan-U/mongodb-scripts.git
cd mongodb-scripts
```

### 2. Pick a script

Browse the `scripts/` folder and open the script you need. Read the header comments for its purpose, parameters, and prerequisites.

### 3. Run it

```bash
# mongosh script
mongosh "mongodb://<host>:<port>" --file scripts/<script-name>.js

# shell script
bash scripts/<script-name>.sh
```

> Always test in a **non-production** environment first.

## Conventions

- Each script starts with a short header: **purpose, usage, prerequisites**
- File names are lowercase and hyphen-separated (for example `my-script.js`)
- No credentials, hostnames, or secrets are hardcoded; pass them as parameters or environment variables
- Destructive actions must be clearly labelled and, where possible, require explicit confirmation

## Security

- Never commit passwords, connection strings, or keys
- Use least-privilege MongoDB users; prefer read-only users where possible
- Review every script before running it against production
- Take appropriate backups before any change to a production system

## Roadmap

- [x] Repository structure and conventions
- [ ] Add scripts, organised by category
- [ ] Add reference documentation in `docs/`
- [ ] Standardise script headers and parameters
- [ ] Add usage examples for each script

## Contributing

Issues and pull requests are welcome.

1. Create a branch for your change
2. Add or update the script with header documentation
3. Test in a non-production environment
4. Open a pull request for review

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Disclaimer

These scripts are provided as-is. Review and test them before running against production systems.

## Author

**Madan U** — Cloud DBA · [GitHub](https://github.com/Madan-U)

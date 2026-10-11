---
name: wordpress-local-development
version: 0.1.0
description: Set up a local WordPress development environment using DDEV or LocalWP. Use when the project platform is WordPress and a local environment is needed.
status: approved
category: platform
whenToInvoke: When the client project uses WordPress and a local development environment needs to be configured. Use BEFORE any theme or plugin modifications.
requiredInputs:
  - WordPress source code (theme, plugins)
  - Database export (requires explicit client authorisation)
  - wp-config.php or environment credentials
preconditions:
  - Platform detected as WordPress
  - Database export authorised by client
  - Docker Desktop running (for DDEV)
  - DDEV or LocalWP installed
requiredTools:
  - ddev (preferred) or localwp
  - wp-cli
  - git
  - docker (for DDEV)
requiredPermissions:
  - local-file-creation
  - local-source-modification
expectedOutputs:
  - Running local WordPress instance
  - Local URL for testing
  - WP-CLI access confirmed
platforms:
  - wordpress
  - woocommerce
safetyConstraints:
  - NEVER download production database without explicit written authorisation
  - NEVER use production credentials in local config
  - NEVER commit wp-config.php or .env files with real credentials
  - NEVER install untrusted plugins from non-official sources
examples:
  - "Setup: ddev config && ddev start"
  - "Import: ddev import-db --file=database.sql.gz"
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---

# WordPress Local Development

## Prerequisites

Before starting, confirm:
- [ ] Written authorisation to copy the database
- [ ] Source code access (theme, plugins)
- [ ] DDEV installed: https://ddev.com/get-started/
- [ ] Docker Desktop running

## Option A: DDEV (recommended)

DDEV provides reproducible, containerised WordPress environments.

### Setup

```bash
mkdir -p ~/Sites/<client-slug>
cd ~/Sites/<client-slug>

# Initialise DDEV project
ddev config \
  --project-type=wordpress \
  --project-name=<client-slug> \
  --php-version=8.2

# Start the environment
ddev start

# Install WordPress
ddev wp core download
ddev wp config create \
  --dbname=db \
  --dbuser=db \
  --dbpass=db \
  --dbhost=db

# Import database (if authorised)
ddev import-db --file=/path/to/database.sql.gz

# Import uploads (if authorised)
ddev import-files --source=/path/to/uploads.tar.gz

# Activate the correct site URL
ddev wp search-replace 'https://production-url.com' 'https://<client-slug>.ddev.site'
```

### Access

```bash
ddev launch   # Opens the site in browser
ddev describe # Shows URLs and status
```

### Daily workflow

```bash
ddev start    # Start the environment
ddev stop     # Stop (preserves data)
ddev snapshot # Backup database state
```

## Option B: LocalWP

For simpler setups where DDEV is not available.

```bash
# Import site via LocalWP UI
# Or use LocalWP CLI if available:
localwp start <site-name>
```

## WP-CLI usage

```bash
# DDEV
ddev wp plugin list
ddev wp theme list
ddev wp db check

# LocalWP (uses WP-CLI in site environment)
wp plugin list
wp theme list
```

## Important notes

- Local WP admin URL: `https://<client-slug>.ddev.site/wp-admin`
- Default DDEV credentials: db/db/db
- Uploads directory: `wp-content/uploads/` — may need syncing from production
- Plugins may require license keys to function — use the client's keys only

## After setup

1. Confirm site loads correctly
2. Check `ddev wp plugin status` — some plugins may show errors locally
3. Review error logs: `ddev logs`
4. Run theme-specific setup if needed

## Security reminders

- **Never** commit `wp-config.php` with real credentials
- **Never** push the imported database to a public repository
- Use `.env` or DDEV's environment variables for sensitive config
- Store credentials in a password manager, not in files

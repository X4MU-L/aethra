---
name: shopify-development
version: 0.1.0
description: Develop and test Shopify themes and apps using Shopify CLI. Use for Shopify client projects requiring theme customisation or app development.
status: approved
category: platform
whenToInvoke: When the client project uses Shopify and theme or app development is required.
requiredInputs:
  - Shopify store URL or development store access
  - Shopify CLI installed
  - Shopify Partner account (for development stores)
preconditions:
  - Platform detected as Shopify
  - Shopify CLI installed
  - Authentication to Shopify store confirmed
requiredTools:
  - shopify (Shopify CLI)
  - node (>=18)
  - git
requiredPermissions:
  - external-network-read
  - local-file-creation
  - local-source-modification
expectedOutputs:
  - Theme development server running
  - Local preview URL
  - Theme changes applied to development store
platforms:
  - shopify
safetyConstraints:
  - NEVER use production store credentials for testing without explicit authorisation
  - NEVER deploy theme changes directly to live store without review
  - Always use a development store or theme preview for development
  - NEVER install untrusted apps on the production store
examples:
  - shopify theme dev --store=dev-store.myshopify.com
  - shopify theme push --store=dev-store.myshopify.com
  - shopify app dev
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---

# Shopify Development

## Important: Shopify is hosted

Unlike WordPress, Shopify does not run locally. Local development uses:
- **Theme development server**: Hot-reloads against a development store
- **Development stores**: Free Shopify Partner stores for testing

## Prerequisites

1. Install Shopify CLI:
   ```bash
   npm install -g @shopify/cli
   ```

2. Authenticate:
   ```bash
   shopify auth login --store=your-dev-store.myshopify.com
   ```

3. Verify:
   ```bash
   shopify version
   ```

## Theme development

### Set up theme development

```bash
# Clone existing theme
git clone <theme-repo>
cd <theme-dir>

# OR pull from store
shopify theme pull --store=<store>.myshopify.com

# Start dev server (hot-reload against dev store)
shopify theme dev --store=<dev-store>.myshopify.com
```

### Theme structure

```
templates/       # JSON templates
sections/        # Customisable sections
snippets/        # Reusable partials
assets/          # CSS, JS, images
layout/          # Base templates
locales/         # Translation files
config/          # Theme settings
```

### Pushing changes

```bash
# Push to development store (for review)
shopify theme push --store=<dev-store>.myshopify.com

# Push to production (REQUIRES EXPLICIT APPROVAL)
shopify theme push --store=<prod-store>.myshopify.com
```

## App development

```bash
# Create a new app (if needed)
shopify app init

# Start app development server
shopify app dev

# Deploy app (REQUIRES EXPLICIT APPROVAL)
shopify app deploy
```

## Testing

```bash
# Preview theme on different devices
shopify theme dev   # Provides QR code for mobile preview
```

Manual test checklist:
- [ ] Homepage loads correctly
- [ ] Product pages display correctly
- [ ] Cart functionality works
- [ ] Checkout flow (use test mode)
- [ ] Mobile layout is correct

## Important notes

- Theme changes in dev server do not affect live customers
- Use Shopify Inbox or Preview to test before going live
- Test payment flows using Shopify test credit cards
- The `shopify` CLI must be authenticated per-store

## Going live

**Explicit approval required** before:
- Pushing theme to production store
- Deploying apps to production
- Making any changes that affect live customers

Document approval in: `knowledge/decisions.md`

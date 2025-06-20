# Transition to Defang Deployment

This document describes how to shift from the current Vercel-based workflow to Defang.io for container orchestration and cloud deployments.

## Why Defang?

Defang lets you take your app from Docker Compose to a secure and scalable deployment on your favorite cloud in minutes. It abstracts away the complexity of cloud infrastructure and provides an AI-assisted CLI that can generate project outlines and deploy with a single command.

Key features from their documentation include:

- "Develop anything, deploy anywhere" using your existing Docker Compose setup.
- A command-line interface (CLI) that can build and deploy your project with one command.
- Support for major clouds such as AWS, DigitalOcean, and Google Cloud Platform.
- Managed services for Postgres, Redis, and other resources.
- The ability to deploy to a free playground or Bring Your Own Cloud (BYOC) for production.

## Migration Steps

1. **Install the Defang CLI** – Follow the installation instructions in the [Defang docs](https://docs.defang.io/docs/cli/defang) to get the `defang` command on your local machine.
2. **Bootstrap a Project** – Run `defang new` in the repository root. Defang looks for a `compose.yaml` or `docker-compose.yml` at the project root, so this repository now includes `compose.yaml` alongside the `web` directory.
3. **Configure Cloud Provider** – Choose the BYOC provider you want to deploy to (AWS, DigitalOcean, or GCP). Follow the provider-specific steps to create the initial "CD" service in your cloud account.
4. **Update Secrets and Environment Variables** – Transfer any secrets currently stored in Vercel to Defang's configuration. Update environment variables as needed for your cloud services.
5. **Deploy** – Use `defang deploy` to build container images and push them to your cloud's container registry. Defang will provision the necessary infrastructure and deploy your services.
6. **Automate with GitHub Actions** – Use the `DefangLabs/defang-github-action` in a workflow to deploy automatically from CI. A basic example lives in `.github/workflows/defang.yml`.
7. **Iterate and Debug** – The CLI offers commands like `defang tail` to stream logs and an AI agent that can help debug issues based on log output.
8. **Retire Vercel Configuration** – Once your deployments are managed by Defang, remove `vercel.json`, any Vercel-specific adapters, and clean up environment variables or secrets that reference Vercel resources.
9. **Configure Managed Postgres** – Defang supports provisioning Postgres automatically. See [Using Postgres with Defang](defang-postgres.md) for the necessary compose settings and configuration commands.

## Additional Resources

- [What is Defang?](https://docs.defang.io/docs/intro/what-is-defang)
- [How Defang Works](https://docs.defang.io/docs/intro/how-it-works)
- [Defang CLI Reference](https://docs.defang.io/docs/category/cli)


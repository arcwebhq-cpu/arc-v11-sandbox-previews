# ARC V11 sandbox preview seed

This repository seed is a public, inert test target for the ARC V11 five-page
revision flow. It contains one synthetic five-page preview and the minimum
validation and GitHub Pages workflow needed to test immutable source, base,
head, check, merge, deployment, and public-byte bindings.

Safety state:

- every provider, form, payment, email, and fulfillment path is absent and OFF;
- GitHub Pages publication is workflow-only and uploads only `.pages-dist`;
- pull requests must be same-repository, one-parent revisions from the exact
  current `main` source commit;
- revision branches may change a nonempty subset of the five declared HTML
  paths; the source and generated write-set authorities still bind all five;
- CI and the artifact builder have no package dependencies or lifecycle hooks;
- no site-worker configuration, credentials, customer fixtures, or private app
  source belongs in this repository.

Local verification requires Node.js 22 or newer:

```sh
npm test
npm run build:pages
```

The build command creates a disposable `.pages-dist` directory. It does not
publish or call a provider.

# Contributing

This is an experimental source release with limited maintenance capacity.
Contributions must minimise the verification burden placed on the project
owner.

## Evidence required

Issues and pull requests must provide:

- a precise description of the behaviour or defect;
- reproducible steps using synthetic data;
- the exact commit tested;
- relevant test output; and
- a focused explanation of the proposed change.

Do not submit real photographs, family information, credentials, access tokens,
or other personal or sensitive data.

## Automated and AI-assisted contributions

Bulk, speculative, or unverified automated submissions may be closed without
investigation. A person submitting AI-assisted material must review it, remain
answerable for it, and provide enough evidence for another person to reproduce
and verify the claim.

Disclose substantive generative-AI use in the issue or pull request. Identify
the provider and product or model when known, explain what it was used for, and
separate generated output from human verification.

## Tests and scope

Keep changes narrowly scoped. Add or update tests for changed behaviour and run:

```sh
npm run typecheck
npm run lint
npm test
```

Passing tests do not establish security or production readiness. Contributions
that expand deployment, authentication, privacy, custodianship, recovery, or
real-data handling require explicit review and may remain out of scope.

Unless explicitly stated otherwise, intentionally submitted contributions are
provided under the Apache License 2.0 in accordance with its contribution terms.

# Synthetic audience access verification

The fixed staging verifier checks member, mentor and institution audience CTAs
at desktop and mobile sizes. Anonymous visitors reach the local GitHub login
page with the correct return path; the verifier does not follow OAuth. Approved
role fixtures reach the expected workspace. A member without mentor/institution
access sees the approval explanation and community-journey link.

Activation follows the exact checked-out revision: no audience route files means
this check is inactive; a partial set fails; all three pages makes the check
mandatory. Existing deployment-version preflight still applies. Integrate PR190
with this separate test slice before claiming audience acceptance. A remote 404
or wrong destination is a failure, never a reason to skip.

Only the three exact public audience paths are added to the synthetic fixture
allowlist. Existing cross-origin and redirect blocking remains unchanged. The
anonymous context receives no credentials. Authenticated contexts are reused;
all pages and contexts close on success or failure and outer fixture cleanup
still runs. No assessment or chat endpoint is invoked by these checks.

Unit tests validate role navigation, activation, failures, cleanup and exact path
boundaries. They do not establish live audience acceptance. That requires a
PM-reserved staging verification of an integrated revision containing the pages.

Admin coverage uses the existing same-run signed-cookie admin fixture for all
three audience routes on desktop and mobile. The fixed matrix has 22 cases;
missing or mixed-run admin identities fail before browser navigation.

import assert from 'node:assert/strict';
import test from 'node:test';
import { tailscaleEnableLink } from '../src/lib/tailscale-setup.ts';

test("Tailscale's enable link is taken from its own message and nothing else is", () => {
  assert.equal(
    tailscaleEnableLink(
      'Enable HTTPS for this device in Tailscale and retry. Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve?node=niH3FkZ5ef11CNTRL',
    ),
    'https://login.tailscale.com/f/serve?node=niH3FkZ5ef11CNTRL',
  );
  assert.equal(
    tailscaleEnableLink('Visit https://login.tailscale.com/f/serve?node=abc.'),
    'https://login.tailscale.com/f/serve?node=abc',
  );
  assert.equal(tailscaleEnableLink('Visit https://login.tailscale.com.evil.example/x'), null);
  assert.equal(tailscaleEnableLink('Visit http://login.tailscale.com/f/serve'), null);
  assert.equal(tailscaleEnableLink('Sign in to Tailscale on this host first.'), null);
});

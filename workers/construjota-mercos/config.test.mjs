import assert from "node:assert/strict";
import test from "node:test";

import { CONSTRUJOTA_MERCOS_INTERNAL_LIMITS, construjotaMercosConfig } from "./config.mjs";

test("uses robust internal limits and ignores obsolete timeout environment variables", () => {
  const obsolete = {
    CONSTRUJOTA_MERCOS_NAVIGATION_TIMEOUT_MS: process.env.CONSTRUJOTA_MERCOS_NAVIGATION_TIMEOUT_MS,
    CONSTRUJOTA_MERCOS_SIGNAL_TIMEOUT_MS: process.env.CONSTRUJOTA_MERCOS_SIGNAL_TIMEOUT_MS,
    CONSTRUJOTA_MERCOS_ACTION_TIMEOUT_MS: process.env.CONSTRUJOTA_MERCOS_ACTION_TIMEOUT_MS,
    CONSTRUJOTA_MERCOS_NAVIGATION_ATTEMPTS: process.env.CONSTRUJOTA_MERCOS_NAVIGATION_ATTEMPTS,
  };
  process.env.CONSTRUJOTA_MERCOS_NAVIGATION_TIMEOUT_MS = "1";
  process.env.CONSTRUJOTA_MERCOS_SIGNAL_TIMEOUT_MS = "1";
  process.env.CONSTRUJOTA_MERCOS_ACTION_TIMEOUT_MS = "1";
  process.env.CONSTRUJOTA_MERCOS_NAVIGATION_ATTEMPTS = "1";

  try {
    const config = construjotaMercosConfig({ baseUrl: "https://construjota2.mercos.com" });
    assert.equal(config.navigationTimeoutMs, 60_000);
    assert.equal(config.signalTimeoutMs, 30_000);
    assert.equal(config.actionTimeoutMs, 15_000);
    assert.equal(config.navigationAttempts, 3);
    assert.deepEqual(CONSTRUJOTA_MERCOS_INTERNAL_LIMITS, {
      navigationTimeoutMs: 60_000,
      signalTimeoutMs: 30_000,
      actionTimeoutMs: 15_000,
      navigationAttempts: 3,
    });
  } finally {
    for (const [name, value] of Object.entries(obsolete)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("keeps programmatic overrides for isolated automated tests", () => {
  const config = construjotaMercosConfig({
    baseUrl: "https://construjota2.mercos.com",
    navigationTimeoutMs: 50,
    signalTimeoutMs: 40,
    actionTimeoutMs: 30,
    navigationAttempts: 1,
  });
  assert.equal(config.navigationTimeoutMs, 50);
  assert.equal(config.signalTimeoutMs, 40);
  assert.equal(config.actionTimeoutMs, 30);
  assert.equal(config.navigationAttempts, 1);
});

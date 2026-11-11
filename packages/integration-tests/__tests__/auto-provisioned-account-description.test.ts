import { afterAll, beforeAll, expect, it } from "vitest";
import { startTestGatekeeperHarness, TEST_VENDOR_ID, testControl, type Harness } from "../src/harness.js";
import { connect, listConnectedAccounts, nextUsernames, signUp } from "../src/rpc-client.js";

let harness: Harness;

beforeAll(async () => {
  harness = await startTestGatekeeperHarness();
});

afterAll(async () => {
  await harness?.server.close();
});

it("picks up a changed description of an existing auto-provisioned account", async () => {
  const [username] = nextUsernames("described");
  using publicApi = connect(harness.url);
  using api = await signUp(publicApi, username!);
  await api.provisionAmbientAccount(TEST_VENDOR_ID);
  const testAccount = async () => (await listConnectedAccounts(api))
      .find(account => account.vendorId === TEST_VENDOR_ID);

  const before = await testAccount();
  if (before === undefined) throw new Error("The test account was not provisioned");
  const label = before.description.uniqueName!;
  expect(before.description.displayName).toBe(label.split("@")[0]);

  await testControl(harness, "account-display-name", { label, displayName: "Upgraded" });
  await api.listGatekeeperApps();

  expect((await testAccount())?.description.displayName).toBe("Upgraded");
});

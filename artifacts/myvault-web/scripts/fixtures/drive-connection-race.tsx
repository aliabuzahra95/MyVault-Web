import React from "react";
import { createRoot } from "react-dom/client";
import { useGoogleDriveConnection } from "../../src/hooks/useGoogleDriveConnection";
import { requests, type Result } from "./drive-connection-mocks";

let latest: ReturnType<typeof useGoogleDriveConnection>;
function Probe() {
  latest = useGoogleDriveConnection();
  return <output>{JSON.stringify({ status: latest.status, current: latest.scan?.verifiedGraph?.current,
    commit: latest.scan?.verifiedGraph?.commitId, version: latest.metadataRestore?.cloudVersion, error: latest.error })}</output>;
}
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for disposable React state");
}
function result(current: boolean): Result {
  return { scan: { rootFolder: { name: "MyVault Backup Graph v1" }, verifiedGraph: { commitId: current ? "C10" : "C8", current } },
    manifestPreview: null, metadataRestore: { cloudVersion: current ? 10 : 8 } as Result["metadataRestore"],
    staged: !current, graphBackup: true, latestBackup: null };
}

export async function runConnectionRaceTests() {
  const tests: string[] = [];
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element); root.render(<Probe />);
  await until(() => requests.length === 1);
  const restore = latest.restoreMetadata();
  await until(() => requests.length === 2);
  check(requests[1].manual, "Restore was not explicitly manual");
  window.dispatchEvent(new Event("focus"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  check(requests.length === 2, "Foreground check raced the active Restore");
  tests.push("foreground does not start another check during manual Restore");
  requests[1].resolve(result(true)); await restore;
  await until(() => latest.status === "metadata-restored");
  check(latest.scan?.verifiedGraph?.current && latest.metadataRestore?.cloudVersion === 10, "Manual Restore did not report current state");
  requests[0].resolve(result(false));
  await new Promise((resolve) => setTimeout(resolve, 30));
  check(latest.scan?.verifiedGraph?.commitId === "C10" && latest.metadataRestore?.cloudVersion === 10,
    "Late passive result replaced the newer manual Restore result");
  tests.push("late C8 background result cannot overwrite successful C10 Restore");
  window.dispatchEvent(new Event("focus"));
  await until(() => requests.length === 3);
  requests[2].resolve(result(true));
  await until(() => latest.scan?.verifiedGraph?.current === true);
  tests.push("foreground checks resume after manual operation completes");
  const failed = latest.restoreMetadata(); await until(() => requests.length === 4);
  requests[3].reject(new Error("Disposable verification failure"));
  check(await failed === null, "Failed Restore returned success");
  await until(() => latest.status === "error");
  check(latest.error === "Disposable verification failure", "Manual failure was hidden");
  tests.push("manual verification failure stays visible and is not success");
  root.unmount(); element.remove();
  return tests;
}

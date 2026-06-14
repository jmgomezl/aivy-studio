# Ledger Developer Experience — Feedback (ETHGlobal NYC 2026)

Integration: **Device Management Kit (DMK) over WebHID** as the human-in-the-loop
signer for high-value AI-agent settlements in Kickoff. What follows is honest DX
feedback gathered while building it, with evidence and concrete suggestions.

## What worked well
- **DMK builder + signer-kit split is clean.** `new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build()` plus a per-chain `SignerEthBuilder({ dmk, sessionId })` is a sensible separation. Adding a transport vs. a signer is intuitive.
- **The observable/HITL model is the right abstraction.** `DeviceActionStatus.Pending` + `intermediateValue.requiredUserInteraction` maps directly to UI prompts (unlock, confirm-open-app, verify-address, sign-transaction). It made the human-in-the-loop gate trivial to surface honestly.
- **`_tag`-based error classification** (over message-string matching) is a good, stable API choice.
- **Agent Skills** (`ledgerhq/agent-skills`, `ledger-dmk-implementation`) were the single most useful resource — the SDK-reference + code-patterns files had the exact builder/observable shapes. More accurate than what a general web search surfaced.

## Gaps / friction (with evidence)
1. **`@ledgerhq/context-module` is a hidden hard dependency.** Installing only `@ledgerhq/device-signer-kit-ethereum` fails the build with `Module not found: Can't resolve '@ledgerhq/context-module'`. It's a peer dep imported internally (not just for Clear Signing). *Suggestion:* make it a regular dependency of the eth signer kit, or fail fast with a clear install hint.
2. **DMK does not resolve under raw Node ESM.** Importing `@ledgerhq/device-management-kit` directly with `node --input-type=module` throws `Directory import '.../lib/esm/src' is not supported resolving ES modules`. It only works through a bundler (Vite/webpack/tsx). *Evidence:* a Node CLI prototype was blocked; we pivoted to WebHID-in-Vite. *Suggestion:* ship proper `exports`/`index.js` resolution for Node ESM, or document prominently that DMK targets a bundler and that Node usage needs `tsx`/esbuild.
3. **Package names are easy to get wrong.** Several outdated/incorrect names circulate (e.g. `@ledgerhq/device-sdk-ts`, `@ledgerhq/eth-signer-kit`). The correct set is `device-management-kit`, `device-transport-kit-web-hid` (or `-node-hid`), `device-signer-kit-ethereum`, `context-module`. *Suggestion:* a single canonical "install this exact set for EVM + WebHID" snippet at the top of the getting-started page.
4. **`originToken` is under-documented.** The patterns say "pass `originToken` to enable Clear Signing — omit and users see raw hex," but not how to obtain a valid token or what it scopes. *Suggestion:* a short "how to get and what it does" section, plus a note that native transfers Clear-Sign fine without it (only contract calls need the context).
5. **`signTransaction` input format is a sharp edge.** It expects the **RLP-encoded *unsigned* transaction as `Uint8Array`**, and returns `{ r, s, v }` to reassemble. With ethers v6 the path is `getBytes(tx.unsignedSerialized)` → device → `tx.signature = Signature.from({ r, s, v })`. *Suggestion:* an end-to-end ethers v6 EIP-155 example in the docs (build → sign → reassemble → broadcast), since this is where most integration bugs will land.
6. **Peer-dependency noise.** Install emits multiple `ERESOLVE overriding peer dependency` warnings when co-resolved with other web3 libs; not fatal but alarming to first-time integrators.

## Net
DMK is a good fit for "device as the final confirmation gate." The main rough
edges are **Node ESM resolution** and the **missing-`context-module` install
failure** — both are fast wins that would noticeably smooth onboarding. The
Agent Skills materially improved correctness and should be promoted up-front.

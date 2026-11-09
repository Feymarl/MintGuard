// MintGuard — vet CLI.
//   npm run vet -- --ca <contract-address> [--wallet <address>] [--chain bsc]
// Prints the JSON verdict to stdout. Exit code 0 always on a produced
// verdict (even BLOCK/NOT_MINT — the verdict IS the result); exit code 1
// only when vetting itself failed (bad args, unreachable RPC/Sourcify).

import { vetContract } from "./verdict.js";

function parseArgs(argv: string[]): { ca?: string; wallet?: string; chain?: string } {
  const out: { ca?: string; wallet?: string; chain?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ca" && argv[i + 1]) out.ca = argv[++i];
    else if (a === "--wallet" && argv[i + 1]) out.wallet = argv[++i];
    else if (a === "--chain" && argv[i + 1]) out.chain = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run vet -- --ca <contract-address> [--wallet <address>] [--chain bsc]",
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const { ca, wallet, chain } = parseArgs(process.argv.slice(2));
  if (!ca || !/^0x[0-9a-fA-F]{40}$/.test(ca)) {
    console.error("Error: --ca <0x...40 hex chars> is required.");
    console.error("Usage: npm run vet -- --ca <contract-address> [--wallet <address>] [--chain bsc]");
    process.exit(1);
  }
  try {
    const verdict = await vetContract(ca, { chain, walletAddress: wallet });
    console.log(JSON.stringify(verdict, null, 2));
  } catch (err: any) {
    console.error(`Vetting failed: ${err?.message ?? err}`);
    process.exit(1);
  }
}

main();

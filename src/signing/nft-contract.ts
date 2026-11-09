/**
 * MintGuard — compile kontrak demo NFT (BSC testnet) dengan solcjs.
 *
 * Membaca `contracts/MintGuardDemoNFT.sol` + import OpenZeppelin dari
 * `node_modules`, mengembalikan ABI + bytecode. Compile dilakukan
 * in-memory (tanpa artifact di repo) agar deploy script bisa memakainya
 * langsung.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const NFT_CONTRACT_PATH = join(REPO_ROOT, "contracts", "MintGuardDemoNFT.sol");
export const NFT_CONTRACT_NAME = "MintGuardDemoNFT";

export interface CompiledContract {
  abi: unknown[];
  bytecode: `0x${string}`;
}

/** Compile MintGuardDemoNFT.sol; throw bila ada error compiler. */
export function compileNftContract(): CompiledContract {
  const source = readFileSync(NFT_CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: { "MintGuardDemoNFT.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (path: string) => {
        // Hanya import OpenZeppelin dari node_modules yang diizinkan.
        if (!path.startsWith("@openzeppelin/contracts/")) {
          return { error: `Import tidak diizinkan: ${path}` };
        }
        const full = join(REPO_ROOT, "node_modules", path);
        try {
          return { contents: readFileSync(full, "utf8") };
        } catch {
          return { error: `Import tidak ditemukan: ${path}` };
        }
      },
    }),
  ) as {
    errors?: { severity: string; formattedMessage: string }[];
    contracts?: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>>;
  };

  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      "Compile gagal:\n" + errors.map((e) => e.formattedMessage).join("\n"),
    );
  }
  const compiled = output.contracts?.["MintGuardDemoNFT.sol"]?.[NFT_CONTRACT_NAME];
  if (!compiled || !compiled.evm?.bytecode?.object) {
    throw new Error("Compile tidak menghasilkan bytecode untuk MintGuardDemoNFT.");
  }
  return {
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
  };
}

// CLI: npx tsx src/signing/nft-contract.ts — cetak ringkasan hasil compile.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { abi, bytecode } = compileNftContract();
  console.log(`Contract : ${NFT_CONTRACT_NAME} (${NFT_CONTRACT_PATH})`);
  console.log(`ABI items: ${abi.length}`);
  console.log(`Bytecode : ${(bytecode.length - 2) / 2} bytes`);
  console.log(`Keccak   : ${bytecode.slice(0, 66)}...`);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * MintGuardDemoNFT — kontrak target demo Layer A (BSC testnet only).
 *
 * ERC721 free-mint minimal: siapa pun boleh mint 1 NFT gratis (gas-only),
 * tokenId berurutan mulai dari 1. Dipakai sebagai target eksekusi agen
 * MintGuard: vet -> derive -> MPC sign -> broadcast -> ownerOf check.
 *
 * BUKAN kontrak produksi: tanpa allowlist, tanpa royalty, tanpa batas
 * supply selain maxSupply. Hanya untuk demo hackathon di testnet.
 */
contract MintGuardDemoNFT is ERC721 {
    uint256 public nextTokenId = 1;
    uint256 public constant MAX_SUPPLY = 1000;

    constructor() ERC721("MintGuard Demo NFT", "MGDEMO") {}

    /// Mint gratis 1 NFT ke pemanggil (gas-only, tanpa pembayaran).
    function mint() external returns (uint256 tokenId) {
        require(nextTokenId <= MAX_SUPPLY, "sold out");
        tokenId = nextTokenId;
        nextTokenId += 1;
        _safeMint(msg.sender, tokenId);
    }

    function totalSupply() external view returns (uint256) {
        return nextTokenId - 1;
    }
}

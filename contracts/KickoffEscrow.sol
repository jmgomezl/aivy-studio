// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title KickoffEscrow — optional buyer-funded escrow for a negotiation
/// @notice When a buyer opts in, funds for the offer are LOCKED in this contract
///         on-chain before the seller agent decides. On accept the admin RELEASES
///         them to the seller; on reject the admin REFUNDS the buyer. Real custody
///         boundary: the HBAR genuinely leaves the funder's wallet, sits in the
///         contract, then moves to seller or back to buyer — each leg a distinct
///         on-chain transaction recorded back on HCS-10. Deployed on Hedera EVM.
///
///         For the demo the operator funds the lock on the buyer's behalf, capped
///         at a small amount — the managed buyer wallet is identity-only today.
///         The custody boundary and the release/refund legs are nonetheless real.
contract KickoffEscrow {
    enum Status { None, Locked, Released, Refunded }

    struct Deal {
        address buyer;
        address seller;
        uint256 amountWei;
        Status status;
    }

    address public admin;
    mapping(bytes32 => Deal) public deals;

    event Locked(bytes32 indexed dealId, address indexed buyer, address indexed seller, uint256 amountWei);
    event Released(bytes32 indexed dealId, address indexed seller, uint256 amountWei);
    event Refunded(bytes32 indexed dealId, address indexed buyer, uint256 amountWei);

    constructor() {
        admin = msg.sender;
    }

    /// @notice Lock the offer amount in escrow. msg.value funds the deal.
    function lock(bytes32 dealId, address buyer, address seller) external payable {
        require(deals[dealId].status == Status.None, "deal exists");
        require(msg.value > 0, "amount required");
        require(buyer != address(0) && seller != address(0), "zero addr");
        deals[dealId] = Deal(buyer, seller, msg.value, Status.Locked);
        emit Locked(dealId, buyer, seller, msg.value);
    }

    /// @notice Deal accepted — release escrow to the seller.
    function release(bytes32 dealId) external {
        require(msg.sender == admin, "not admin");
        Deal storage d = deals[dealId];
        require(d.status == Status.Locked, "not locked");
        d.status = Status.Released;
        (bool ok, ) = d.seller.call{value: d.amountWei}("");
        require(ok, "transfer failed");
        emit Released(dealId, d.seller, d.amountWei);
    }

    /// @notice Deal rejected — refund escrow to the buyer.
    function refund(bytes32 dealId) external {
        require(msg.sender == admin, "not admin");
        Deal storage d = deals[dealId];
        require(d.status == Status.Locked, "not locked");
        d.status = Status.Refunded;
        (bool ok, ) = d.buyer.call{value: d.amountWei}("");
        require(ok, "transfer failed");
        emit Refunded(dealId, d.buyer, d.amountWei);
    }

    function getDeal(bytes32 dealId) external view returns (address, address, uint256, Status) {
        Deal storage d = deals[dealId];
        return (d.buyer, d.seller, d.amountWei, d.status);
    }
}

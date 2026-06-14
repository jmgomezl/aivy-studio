// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title KickoffInsurance — optional package insurance ("seguro")
/// @notice A buyer (or seller) can insure a deal against damage/loss for a small
///         premium paid into the pool. If the package is damaged or lost, the
///         policyholder files a claim and the admin pays the coverage from the
///         pool. Optional, on-chain, per deal. Deployed on Hedera EVM.
contract KickoffInsurance {
    struct Policy {
        address beneficiary;
        uint256 premiumWei;   // premium paid (weibars)
        uint256 coverageHbar; // coverage amount, in HBAR (metadata)
        bool claimed;
        bool paid;
        bool active;
    }

    address public admin;
    mapping(bytes32 => Policy) public policies;

    event PolicyBought(bytes32 indexed dealId, address indexed beneficiary, uint256 premiumWei, uint256 coverageHbar);
    event ClaimFiled(bytes32 indexed dealId, address indexed by);
    event ClaimPaid(bytes32 indexed dealId, address indexed to, uint256 amountWei);

    constructor() {
        admin = msg.sender;
    }

    /// @notice Buy a policy for a deal. The premium (msg.value) funds the pool.
    function insure(bytes32 dealId, address beneficiary, uint256 coverageHbar) external payable {
        require(!policies[dealId].active, "policy exists");
        require(msg.value > 0, "premium required");
        require(beneficiary != address(0), "zero beneficiary");
        policies[dealId] = Policy(beneficiary, msg.value, coverageHbar, false, false, true);
        emit PolicyBought(dealId, beneficiary, msg.value, coverageHbar);
    }

    /// @notice The policyholder reports damage/loss.
    function fileClaim(bytes32 dealId) external {
        Policy storage p = policies[dealId];
        require(p.active && !p.paid, "no active policy");
        p.claimed = true;
        emit ClaimFiled(dealId, msg.sender);
    }

    /// @notice Admin approves a claim and pays out from the pool.
    function payClaim(bytes32 dealId, uint256 amountWei) external {
        require(msg.sender == admin, "not admin");
        Policy storage p = policies[dealId];
        require(p.claimed && !p.paid, "not claimable");
        require(amountWei <= address(this).balance, "pool too low");
        p.paid = true;
        (bool ok, ) = p.beneficiary.call{value: amountWei}("");
        require(ok, "transfer failed");
        emit ClaimPaid(dealId, p.beneficiary, amountWei);
    }

    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

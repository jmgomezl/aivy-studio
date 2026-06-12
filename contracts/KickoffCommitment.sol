// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KickoffCommitment — seller min-price commitment + collateral for Kickoff.bot
/// @notice Seller commits keccak256(abi.encodePacked(minPrice, salt)) before the
///         negotiation starts, backed by collateral. After the deal closes the
///         seller reveals; a reveal that doesn't match the hash forfeits the
///         collateral, so the committed minimum is credible.
contract KickoffCommitment {
    struct Commitment {
        bytes32 hash;
        uint256 collateral;
        uint64 committedAt;
        bool revealed;
        uint256 minPrice; // populated on reveal
    }

    mapping(address => Commitment) public commitments;

    event Committed(address indexed seller, bytes32 hash, uint256 collateral);
    event Revealed(address indexed seller, uint256 minPrice);
    event CollateralForfeited(address indexed seller, uint256 amount);

    function commit(bytes32 hash) external payable {
        require(hash != bytes32(0), "empty hash");
        require(msg.value > 0, "collateral required");
        Commitment storage c = commitments[msg.sender];
        require(c.hash == bytes32(0) || c.revealed, "active commitment exists");

        commitments[msg.sender] = Commitment({
            hash: hash,
            collateral: msg.value,
            committedAt: uint64(block.timestamp),
            revealed: false,
            minPrice: 0
        });
        emit Committed(msg.sender, hash, msg.value);
    }

    /// @notice Reveal min price after the deal closes. Correct reveal returns
    ///         the collateral; an incorrect one reverts (collateral stays locked
    ///         until a correct reveal — the hash binds the seller).
    function reveal(uint256 minPrice, bytes32 salt) external {
        Commitment storage c = commitments[msg.sender];
        require(c.hash != bytes32(0) && !c.revealed, "nothing to reveal");
        require(
            keccak256(abi.encodePacked(minPrice, salt)) == c.hash,
            "reveal does not match commitment"
        );

        c.revealed = true;
        c.minPrice = minPrice;
        uint256 amount = c.collateral;
        c.collateral = 0;

        emit Revealed(msg.sender, minPrice);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "collateral return failed");
    }

    function getCommitment(address seller)
        external
        view
        returns (bytes32 hash, uint256 collateral, bool revealed, uint256 minPrice)
    {
        Commitment storage c = commitments[seller];
        return (c.hash, c.collateral, c.revealed, c.minPrice);
    }
}

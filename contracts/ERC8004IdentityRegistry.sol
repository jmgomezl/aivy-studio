// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ERC-8004 Identity Registry (Trustless Agents)
/// @notice Minimal on-chain registry giving each agent a portable identity
///         (agentId ⇄ agentDomain ⇄ agentAddress). Deployed for Kickoff on
///         Hedera EVM so the seller/buyer agents have a trustless, resolvable
///         identity that their reputation can anchor to. Follows the ERC-8004
///         Identity Registry interface.
contract ERC8004IdentityRegistry {
    struct AgentInfo {
        uint256 agentId;
        string agentDomain;
        address agentAddress;
    }

    uint256 public agentCount;
    mapping(uint256 => AgentInfo) private _agents;
    mapping(address => uint256) private _byAddress;
    mapping(bytes32 => uint256) private _byDomain;

    event AgentRegistered(uint256 indexed agentId, string agentDomain, address indexed agentAddress);
    event AgentUpdated(uint256 indexed agentId, string agentDomain, address indexed agentAddress);

    /// @notice Register a new agent. Returns the assigned agentId.
    function newAgent(string calldata agentDomain, address agentAddress) external returns (uint256 agentId) {
        require(agentAddress != address(0), "zero address");
        require(_byAddress[agentAddress] == 0, "address registered");
        bytes32 dk = keccak256(bytes(agentDomain));
        require(_byDomain[dk] == 0, "domain registered");

        agentId = ++agentCount;
        _agents[agentId] = AgentInfo(agentId, agentDomain, agentAddress);
        _byAddress[agentAddress] = agentId;
        _byDomain[dk] = agentId;
        emit AgentRegistered(agentId, agentDomain, agentAddress);
    }

    /// @notice Update an existing agent. Only the current agent address may update.
    function updateAgent(uint256 agentId, string calldata agentDomain, address agentAddress) external returns (bool) {
        AgentInfo storage a = _agents[agentId];
        require(a.agentId != 0, "unknown agent");
        require(msg.sender == a.agentAddress, "not agent");

        delete _byAddress[a.agentAddress];
        delete _byDomain[keccak256(bytes(a.agentDomain))];

        a.agentDomain = agentDomain;
        a.agentAddress = agentAddress;
        _byAddress[agentAddress] = agentId;
        _byDomain[keccak256(bytes(agentDomain))] = agentId;
        emit AgentUpdated(agentId, agentDomain, agentAddress);
        return true;
    }

    function getAgent(uint256 agentId) external view returns (AgentInfo memory) {
        return _agents[agentId];
    }

    function resolveByAddress(address agentAddress) external view returns (AgentInfo memory) {
        return _agents[_byAddress[agentAddress]];
    }

    function resolveByDomain(string calldata agentDomain) external view returns (AgentInfo memory) {
        return _agents[_byDomain[keccak256(bytes(agentDomain))]];
    }
}

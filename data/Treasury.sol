// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Treasury
/// @notice Records service-agent earnings on Monad, splits 70/30, and gates
///         every spending-agent expense (hosting, AI/API, manual) against
///         the resulting on-chain limit. Off-chain relay syncs the limit to
///         a Rain card and confirms real spends via recordSpend.
contract Treasury {
    address public owner;
    address public spendingAgent;

    // Cumulative lifetime earnings per service agent (Price-Check, Shopping, etc.)
    mapping(address => uint256) public earnings;

    // Pooled spend limit currently available to the spending agent
    uint256 public spendLimit;

    // Total ever spent by the spending agent (for audit / dashboard)
    uint256 public totalSpent;

    enum Category { HOSTING, AI_API, MANUAL }

    struct Expense {
        uint256 amount;
        Category category;
        string description;
        uint256 timestamp;
        bool approved;
    }

    Expense[] public expenses;

    event Earned(address indexed agent, uint256 amount, uint256 newSpendLimit);
    event ExpenseRequested(uint256 indexed id, uint256 amount, Category category, string description, bool approved);
    event SpendConfirmed(uint256 indexed id, uint256 amount); // fired once Rain webhook confirms real card charge

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _spendingAgent) {
        owner = msg.sender;
        spendingAgent = _spendingAgent;
    }

    /// @notice Called by the backend relay whenever a service agent gets paid
    ///         by a user (e.g. after a chat session ends and the card is charged).
    /// @param agent The service agent that earned the revenue (Price-Check, Shopping, etc.)
    /// @param amount Revenue amount in smallest unit (e.g. cents or token wei)
    function recordEarning(address agent, uint256 amount) external onlyOwner {
        earnings[agent] += amount;

        uint256 toSpendingAgent = (amount * 70) / 100;
        // remaining 30% stays as retained earnings, tracked implicitly via earnings[agent] - spendLimit history

        spendLimit += toSpendingAgent;

        emit Earned(agent, amount, spendLimit);
    }

    /// @notice The spending agent (or backend acting on its behalf) requests to spend.
    ///         Covers recurring hosting/AI bills and one-off manual expenses alike.
    /// @return approved Whether the spend fits within the current limit
    function requestExpense(uint256 amount, Category category, string calldata description)
        external
        returns (bool approved)
    {
        require(msg.sender == spendingAgent || msg.sender == owner, "not authorized");

        approved = amount <= spendLimit;

        if (approved) {
            spendLimit -= amount;
            totalSpent += amount;
        }

        expenses.push(Expense(amount, category, description, block.timestamp, approved));
        emit ExpenseRequested(expenses.length - 1, amount, category, description, approved);

        return approved;
    }

    /// @notice Called by the backend relay after Rain's webhook confirms the card
    ///         charge actually went through, closing the audit loop.
    function confirmSpend(uint256 expenseId) external onlyOwner {
        require(expenseId < expenses.length, "invalid id");
        require(expenses[expenseId].approved, "expense not approved");
        emit SpendConfirmed(expenseId, expenses[expenseId].amount);
    }

    function expenseCount() external view returns (uint256) {
        return expenses.length;
    }

    function remainingLimit() external view returns (uint256) {
        return spendLimit;
    }
}

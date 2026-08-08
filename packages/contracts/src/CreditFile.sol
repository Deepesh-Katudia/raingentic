// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title CreditFile
 * @notice Append-only earnings ledger. Deliberately dumb: no access control, no
 *         upgradeability, no ownership. This is a provable record of income, not
 *         a DeFi protocol. Anyone may record receipts against their own address;
 *         msg.sender is always the earning agent.
 */
contract CreditFile {
    struct Receipt {
        address payer;
        uint64 amountMicro; // micro-USD; 1 USDC base unit == 1 micro-USD
        uint64 timestamp;
    }

    /**
     * Views scan at most this many trailing receipts. Sized for the demo rate:
     * 9 receipts/sec over a 120s window is ~1080, so 2000 covers the window with
     * headroom. A lower cap silently truncates the window and halves the limit.
     */
    uint256 public constant MAX_SCAN = 2000;

    mapping(address => Receipt[]) public receipts;
    mapping(address => uint256) public totalEarnedMicro;

    event ReceiptRecorded(
        address indexed agent,
        address indexed payer,
        uint64 amountMicro,
        uint64 timestamp
    );

    function recordReceipt(address payer, uint64 amountMicro) external {
        _record(msg.sender, payer, amountMicro);
    }

    /**
     * @notice Batched write. The seller flushes its receipt queue on a short
     *         interval, which turns ~9 tx/sec from one EOA into ~2 tx/sec and
     *         shrinks the nonce-race surface.
     */
    function recordReceiptBatch(address[] calldata payers, uint64[] calldata amountsMicro) external {
        require(payers.length == amountsMicro.length, "length mismatch");
        for (uint256 i = 0; i < payers.length; i++) {
            _record(msg.sender, payers[i], amountsMicro[i]);
        }
    }

    function _record(address agent, address payer, uint64 amountMicro) internal {
        uint64 ts = uint64(block.timestamp);
        receipts[agent].push(Receipt(payer, amountMicro, ts));
        totalEarnedMicro[agent] += amountMicro;
        emit ReceiptRecorded(agent, payer, amountMicro, ts);
    }

    function receiptCount(address agent) external view returns (uint256) {
        return receipts[agent].length;
    }

    function getReceipts(address agent, uint64 sinceTs) external view returns (Receipt[] memory) {
        Receipt[] storage all = receipts[agent];
        uint256 n = all.length;
        uint256 start = n > MAX_SCAN ? n - MAX_SCAN : 0;

        uint256 count = 0;
        for (uint256 i = start; i < n; i++) {
            if (all[i].timestamp >= sinceTs) count++;
        }

        Receipt[] memory out = new Receipt[](count);
        uint256 j = 0;
        for (uint256 i = start; i < n; i++) {
            if (all[i].timestamp >= sinceTs) {
                out[j] = all[i];
                j++;
            }
        }
        return out;
    }

    /**
     * @notice Aggregate view the underwriter polls. distinctPayers is counted
     *         with a linear scan; the inner loop is bounded by the number of
     *         distinct payers (3 in the demo), not by the receipt count.
     */
    function getProfile(address agent, uint64 windowSecs)
        external
        view
        returns (uint64 earnedInWindowMicro, uint32 distinctPayers, uint64 totalEarned)
    {
        Receipt[] storage all = receipts[agent];
        uint256 n = all.length;
        uint256 start = n > MAX_SCAN ? n - MAX_SCAN : 0;

        uint64 nowTs = uint64(block.timestamp);
        uint64 cutoff = nowTs > windowSecs ? nowTs - windowSecs : 0;

        address[] memory seen = new address[](n - start);
        uint256 seenCount = 0;
        uint256 earned = 0;

        for (uint256 i = start; i < n; i++) {
            Receipt storage r = all[i];
            if (r.timestamp < cutoff) continue;

            earned += r.amountMicro;

            bool found = false;
            for (uint256 k = 0; k < seenCount; k++) {
                if (seen[k] == r.payer) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                seen[seenCount] = r.payer;
                seenCount++;
            }
        }

        earnedInWindowMicro = uint64(earned);
        distinctPayers = uint32(seenCount);
        totalEarned = uint64(totalEarnedMicro[agent]);
    }
}

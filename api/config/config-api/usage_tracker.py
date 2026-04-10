"""
Usage Tracker
Tracks API usage and costs across all providers
"""

import json
import os
from pathlib import Path
from datetime import datetime
from typing import Optional


class UsageTracker:
    """
    Track API usage and costs across all providers.

    Maintains a JSON log of all API calls with:
    - Timestamp
    - Provider used
    - Agent that made the call
    - Token counts
    - Cost in USD
    - Status (success/failure)
    """

    def __init__(self, config: dict):
        """
        Initialize usage tracker.

        Args:
            config: agency-config.json as dict
        """
        self.config = config
        # Resolve log path relative to this file's directory (system-google-sheets-addon/config/config-api/)
        # so it works regardless of the working directory the agent is launched from.
        _base = Path(__file__).parent.parent.parent  # → system-google-sheets-addon/
        relative = config.get("usage_control", {}).get("track_file", "config/logs/api-usage.json")
        self.log_file = _base / relative
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

    def log_request(
        self,
        agent_name: str,
        provider: str,
        tokens_in: int,
        tokens_out: int,
        cost: float,
        status: str = "success",
        metadata: Optional[dict] = None,
    ) -> None:
        """
        Log an API request.

        Args:
            agent_name: Name of agent making the call
            provider: Provider used ("claude", "chatgpt", "grok")
            tokens_in: Input tokens
            tokens_out: Output tokens
            cost: Cost in USD
            status: "success" or "failure"
            metadata: Optional additional metadata
        """
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "agent": agent_name,
            "provider": provider,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "total_tokens": tokens_in + tokens_out,
            "cost_usd": round(cost, 4),
            "status": status,
        }

        if metadata:
            log_entry["metadata"] = metadata

        # Load existing logs
        logs = self._load_logs()
        logs.append(log_entry)

        # Write back
        with open(self.log_file, "w") as f:
            json.dump(logs, f, indent=2)

    def get_usage_summary(self) -> dict:
        """
        Get summary of all usage.

        Returns:
            Dict with totals by provider and agent
        """
        logs = self._load_logs()

        summary = {
            "total_calls": len(logs),
            "total_tokens": 0,
            "total_cost": 0.0,
            "by_provider": {},
            "by_agent": {},
        }

        for log in logs:
            if log.get("status") != "success":
                continue

            provider = log.get("provider", "unknown")
            agent = log.get("agent", "unknown")
            cost = log.get("cost_usd", 0)
            tokens = log.get("total_tokens", 0)

            summary["total_cost"] += cost
            summary["total_tokens"] += tokens

            if provider not in summary["by_provider"]:
                summary["by_provider"][provider] = {
                    "calls": 0,
                    "tokens": 0,
                    "cost": 0.0,
                }

            summary["by_provider"][provider]["calls"] += 1
            summary["by_provider"][provider]["tokens"] += tokens
            summary["by_provider"][provider]["cost"] += cost

            if agent not in summary["by_agent"]:
                summary["by_agent"][agent] = {"calls": 0, "tokens": 0, "cost": 0.0}

            summary["by_agent"][agent]["calls"] += 1
            summary["by_agent"][agent]["tokens"] += tokens
            summary["by_agent"][agent]["cost"] += cost

        return summary

    def print_summary(self) -> None:
        """Print usage summary to console"""
        summary = self.get_usage_summary()

        print("\n" + "=" * 70)
        print("API USAGE SUMMARY")
        print("=" * 70)

        print(f"\nTotal Calls: {summary['total_calls']}")
        print(f"Total Tokens: {summary['total_tokens']:,}")
        print(f"Total Cost: ${summary['total_cost']:.4f}")

        if summary["by_provider"]:
            print("\n--- BY PROVIDER ---")
            for provider, stats in summary["by_provider"].items():
                print(
                    f"{provider:15} | Calls: {stats['calls']:3} | "
                    f"Tokens: {stats['tokens']:7,} | Cost: ${stats['cost']:.4f}"
                )

        if summary["by_agent"]:
            print("\n--- BY AGENT ---")
            for agent, stats in summary["by_agent"].items():
                print(
                    f"{agent:20} | Calls: {stats['calls']:3} | "
                    f"Tokens: {stats['tokens']:7,} | Cost: ${stats['cost']:.4f}"
                )

        print("=" * 70 + "\n")

    def check_cost_limit(self) -> tuple[bool, float, float]:
        """
        Check if current calendar-month cost exceeds the hard limit.

        Uses a rolling monthly window so the limit resets each month.
        Previously this summed all-time cost, which would permanently block
        API calls after the first month's limit was hit.

        Returns:
            (within_limit: bool, current_month_cost: float, limit: float)
        """
        limit = self.config.get("usage_control", {}).get("cost_tracking", {}).get("hard_limit_dollars", 100)
        logs = self._load_logs()
        now = datetime.now()
        current_month_cost = 0.0

        for log in logs:
            if log.get("status") != "success":
                continue
            try:
                log_dt = datetime.fromisoformat(log["timestamp"])
                if log_dt.year == now.year and log_dt.month == now.month:
                    current_month_cost += log.get("cost_usd", 0)
            except (ValueError, KeyError):
                continue

        return (current_month_cost < limit, current_month_cost, limit)

    def check_requests_per_agent_per_day(self, agent_name: str) -> tuple[bool, int, int]:
        """
        Check if agent exceeded daily request limit.

        Returns:
            (within_limit: bool, requests_today: int, limit: int)
        """
        limit = (
            self.config.get("agents", {})
            .get(agent_name, {})
            .get("rate_limit", {})
            .get("requests_per_day", 100)
        )

        logs = self._load_logs()
        today = datetime.now().date()
        today_requests = 0

        for log in logs:
            log_date = datetime.fromisoformat(log["timestamp"]).date()
            if log_date == today and log.get("agent") == agent_name:
                today_requests += 1

        return (today_requests < limit, today_requests, limit)

    def _load_logs(self) -> list:
        """Load existing logs from file"""
        if not self.log_file.exists():
            return []

        try:
            with open(self.log_file, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []

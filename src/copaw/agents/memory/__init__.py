# -*- coding: utf-8 -*-
"""Memory management module for CoPaw agents.

Provides interchangeable memory backends:
- ``MemoryManager`` – local ReMeLight-based memory (default).
- ``ADBPGMemoryManager`` – AnalyticDB for PostgreSQL long-term memory.

Use ``create_memory_manager()`` to instantiate the correct backend
based on per-agent configuration, or call ``register_memory_manager()`` to
add a custom backend before creating managers.
"""

from .agent_md_manager import AgentMdManager
from .memory_manager import MemoryManager
from .adbpg_memory_manager import ADBPGMemoryManager
from .factory import create_memory_manager, register_memory_manager

__all__ = [
    "AgentMdManager",
    "MemoryManager",
    "ADBPGMemoryManager",
    "create_memory_manager",
    "register_memory_manager",
]

# -*- coding: utf-8 -*-
"""Factory for creating memory manager instances.

Uses a registry pattern so that new backends can be added via
``register_memory_manager()`` without modifying this module.

Built-in backends (``local`` and ``adbpg``) are registered at
import time.  Third-party or future backends can call
``register_memory_manager()`` before ``create_memory_manager`` is invoked.
"""
import logging
from typing import Any, Callable

from copaw.config.config import load_agent_config

logger = logging.getLogger(__name__)

# backend name (lower-case) -> lazy creator callable
_REGISTRY: dict[str, Callable[..., Any]] = {}


def register_memory_manager(
    name: str,
    creator: Callable[..., Any],
) -> None:
    """Register a memory-manager backend.

    Args:
        name: Backend identifier (case-insensitive, stored lower-case).
        creator: Callable ``(working_dir, agent_id, config=None) -> manager``
    """
    _REGISTRY[name.lower()] = creator


def create_memory_manager(working_dir: str, agent_id: str):
    """Create a memory manager instance based on agent config.

    Reads ``agent_config.memory_manager.backend`` to determine which
    backend to use.  Defaults to ``"local"`` when not configured.

    Args:
        working_dir: Working directory path for memory storage.
        agent_id: Unique agent identifier.

    Returns:
        A memory manager instance for the selected backend.
    """
    memory_manager_config = None
    backend = "local"
    try:
        agent_config = load_agent_config(agent_id)
        memory_manager_config = getattr(
            agent_config, "memory_manager", None,
        )
        if memory_manager_config and memory_manager_config.backend:
            backend = memory_manager_config.backend
    except Exception:
        pass

    backend = backend.lower()

    creator = _REGISTRY.get(backend)
    if creator is None:
        logger.warning(
            "Unknown memory backend '%s' for agent '%s', "
            "falling back to 'local'.",
            backend,
            agent_id,
        )
        creator = _REGISTRY["local"]

    logger.info(
        "Using '%s' memory backend for agent '%s'.", backend, agent_id,
    )
    return creator(
        working_dir=working_dir,
        agent_id=agent_id,
        config=memory_manager_config,
    )


# -------------------------------------------------------------------
# Built-in backend registrations (lazy imports to avoid cycles)
# -------------------------------------------------------------------

def _create_local(working_dir: str, agent_id: str, config=None):
    from .memory_manager import MemoryManager

    return MemoryManager(working_dir=working_dir, agent_id=agent_id)


def _create_adbpg(working_dir: str, agent_id: str, config=None):
    from .adbpg_memory_manager import ADBPGMemoryManager

    adbpg_cfg = getattr(config, "adbpg", None) if config else None
    return ADBPGMemoryManager(
        working_dir=working_dir,
        agent_id=agent_id,
        adbpg_config=adbpg_cfg,
    )


register_memory_manager("local", _create_local)
register_memory_manager("adbpg", _create_adbpg)

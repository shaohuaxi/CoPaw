"""ADBPG Memory CLI — manage ADBPG long-term memory from the command line.

Main entry point using click. Implements all commands:
init, add, search, list, delete, config (show/set/path), status, version.
"""

import json
import sys
import time

import click

from .client import ADBPGMemoryCLIClient, parse_json_messages, text_to_messages
from .config import (
    CONFIG_FILE,
    load_config,
    mask_sensitive,
    merge_config,
    save_config,
    validate_config,
)
from .output import OutputFormatter
from .version import __version__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_scope(ctx: click.Context) -> dict:
    """Return the scope dict from context."""
    return ctx.obj["scope"]


def _get_formatter(ctx: click.Context) -> OutputFormatter:
    """Return the OutputFormatter from context."""
    return ctx.obj["formatter"]


def _get_client(ctx: click.Context) -> ADBPGMemoryCLIClient:
    """Create a client from the merged config in context."""
    return ADBPGMemoryCLIClient(ctx.obj["config"])


def _echo_result(ctx, command: str, data, duration_ms: int, count=None):
    """Format and echo a successful result."""
    fmt = _get_formatter(ctx)
    scope = _get_scope(ctx)
    click.echo(fmt.format_result(command, data, scope, duration_ms, count))


def _echo_error(ctx, command: str, error: str, duration_ms: int):
    """Format and echo an error result."""
    fmt = _get_formatter(ctx)
    scope = _get_scope(ctx)
    click.echo(fmt.format_error(command, error, scope, duration_ms), err=True)


def _prompt_required(prompt_text: str, default=None):
    """Prompt for a value, re-prompting if empty and no default."""
    while True:
        value = click.prompt(prompt_text, default=default or "", show_default=bool(default))
        if value:
            return value
        click.echo("  This field is required. Please enter a value.")


# ---------------------------------------------------------------------------
# Main group
# ---------------------------------------------------------------------------

@click.group()
@click.option("-o", "--output", type=click.Choice(["text", "json", "table", "quiet", "agent"]), default="text")
@click.option("--json", "json_flag", is_flag=True, help="Shortcut for -o json")
@click.option("--agent", "agent_flag", is_flag=True, help="Shortcut for -o agent")
@click.option("-u", "--user-id", default=None)
@click.option("-a", "--agent-id", default=None)
@click.option("-r", "--run-id", default=None)
@click.version_option(__version__, prog_name="adbpg-mem")
@click.pass_context
def cli(ctx, output, json_flag, agent_flag, user_id, agent_id, run_id):
    """ADBPG Memory CLI — manage ADBPG long-term memory."""
    if agent_flag:
        output = "agent"
    elif json_flag:
        output = "json"
    ctx.ensure_object(dict)
    ctx.obj["output"] = output
    ctx.obj["formatter"] = OutputFormatter(output)
    ctx.obj["config"] = merge_config(user_id=user_id, agent_id=agent_id, run_id=run_id)
    ctx.obj["scope"] = {
        "user_id": user_id or ctx.obj["config"].get("user_id", "default"),
        "agent_id": agent_id or "",
        "run_id": run_id or "",
    }


# ---------------------------------------------------------------------------
# init command
# ---------------------------------------------------------------------------

@cli.command()
@click.pass_context
def init(ctx):
    """Interactive configuration wizard."""
    fmt = _get_formatter(ctx)
    if fmt.is_machine:
        click.echo(
            fmt.format_error("init", "init command requires interactive mode (not available with --json/--agent/--quiet)", _get_scope(ctx), 0),
            err=True,
        )
        ctx.exit(2)
        return

    existing = load_config()

    click.echo("ADBPG Memory CLI — Configuration Wizard")
    click.echo("=" * 42)

    # api_mode
    api_mode = click.prompt(
        "API mode (sql/rest)",
        default=existing.get("api_mode", "sql"),
        type=click.Choice(["sql", "rest"]),
        show_choices=False,
    )

    config: dict = {"api_mode": api_mode}

    if api_mode == "sql":
        config["host"] = _prompt_required("Database host", existing.get("host"))
        port_str = click.prompt("Database port", default=existing.get("port", 5432))
        config["port"] = int(port_str)
        config["user"] = _prompt_required("Database user", existing.get("user"))
        config["password"] = _prompt_required("Database password", existing.get("password"))
        config["dbname"] = _prompt_required("Database name", existing.get("dbname"))
        config["llm_model"] = click.prompt("LLM model", default=existing.get("llm_model", ""))
        config["llm_api_key"] = click.prompt("LLM API key", default=existing.get("llm_api_key", ""))
        config["llm_base_url"] = click.prompt("LLM base URL", default=existing.get("llm_base_url", ""))
        config["embedding_model"] = click.prompt("Embedding model", default=existing.get("embedding_model", ""))
        config["embedding_api_key"] = click.prompt("Embedding API key", default=existing.get("embedding_api_key", ""))
        config["embedding_base_url"] = click.prompt("Embedding base URL", default=existing.get("embedding_base_url", ""))
        dims_str = click.prompt("Embedding dims", default=existing.get("embedding_dims", 1024))
        config["embedding_dims"] = int(dims_str)
    else:
        config["rest_base_url"] = _prompt_required("REST base URL", existing.get("rest_base_url"))
        config["rest_api_key"] = _prompt_required("REST API key", existing.get("rest_api_key"))

    config["user_id"] = click.prompt("Default user ID", default=existing.get("user_id", "default"))

    save_config(config)
    click.echo(f"\nConfiguration saved to {CONFIG_FILE}")


# ---------------------------------------------------------------------------
# add command
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("text", required=False)
@click.option("--file", "file_path", type=click.Path(exists=True), default=None, help="Read text from file")
@click.option("--json-messages", "json_messages", default=None, help="JSON array of messages")
@click.option("--metadata", default=None, help="JSON metadata to attach")
@click.option("--memory-type", default=None, help="Memory type (e.g. procedural_memory)")
@click.option("--prompt", default=None, help="Custom fact extraction prompt (SQL mode only)")
@click.pass_context
def add(ctx, text, file_path, json_messages, metadata, memory_type, prompt):
    """Add a memory. Pass text directly, use '-' for stdin, or --file/--json-messages."""
    t0 = time.time()
    fmt = _get_formatter(ctx)
    scope = _get_scope(ctx)
    config = ctx.obj["config"]

    # Resolve messages
    try:
        if json_messages:
            messages = parse_json_messages(json_messages)
        elif file_path:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            messages = text_to_messages(content)
        elif text == "-":
            content = sys.stdin.read()
            messages = text_to_messages(content)
        elif text:
            messages = text_to_messages(text)
        else:
            _echo_error(ctx, "add", "No input provided. Pass text, use '-' for stdin, --file, or --json-messages.", int((time.time() - t0) * 1000))
            ctx.exit(2)
            return
    except ValueError as e:
        _echo_error(ctx, "add", str(e), int((time.time() - t0) * 1000))
        ctx.exit(2)
        return

    # Parse metadata
    meta = None
    if metadata:
        try:
            meta = json.loads(metadata)
        except json.JSONDecodeError as e:
            _echo_error(ctx, "add", f"Invalid metadata JSON: {e}", int((time.time() - t0) * 1000))
            ctx.exit(2)
            return

    if memory_type and meta is None:
        meta = {}
    if memory_type and meta is not None:
        meta["memory_type"] = memory_type

    # Warn if --prompt used in REST mode
    if prompt and config.get("api_mode") == "rest":
        if not fmt.is_machine:
            click.echo("Warning: --prompt (custom fact extraction) is only available in SQL mode. The flag will be ignored.", err=True)
        prompt = None

    try:
        client = _get_client(ctx)
        result = client.add(
            messages=messages,
            user_id=scope["user_id"],
            agent_id=scope["agent_id"] or None,
            run_id=scope["run_id"] or None,
            metadata=meta,
            prompt=prompt,
        )
    except Exception as e:
        duration_ms = int((time.time() - t0) * 1000)
        _echo_error(ctx, "add", str(e), duration_ms)
        ctx.exit(1)
        return

    duration_ms = int((time.time() - t0) * 1000)
    _echo_result(ctx, "add", result, duration_ms)


# ---------------------------------------------------------------------------
# search command
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("query")
@click.option("--limit", default=5, type=int, help="Max results to return")
@click.pass_context
def search(ctx, query, limit):
    """Semantic search for memories."""
    t0 = time.time()
    scope = _get_scope(ctx)

    try:
        client = _get_client(ctx)
        results = client.search(
            query=query,
            user_id=scope["user_id"],
            agent_id=scope["agent_id"] or None,
            run_id=scope["run_id"] or None,
            limit=limit,
        )
    except Exception as e:
        duration_ms = int((time.time() - t0) * 1000)
        error_msg = str(e)
        if "timeout" in error_msg.lower() or "cancel" in error_msg.lower():
            _echo_error(ctx, "search", f"Search timed out: {error_msg}", duration_ms)
        else:
            _echo_error(ctx, "search", error_msg, duration_ms)
        ctx.exit(1)
        return

    duration_ms = int((time.time() - t0) * 1000)

    fmt = _get_formatter(ctx)
    if not results and not fmt.is_machine:
        click.echo("No matching memories found.")
        return

    _echo_result(ctx, "search", results, duration_ms, count=len(results))


# ---------------------------------------------------------------------------
# list command
# ---------------------------------------------------------------------------

@cli.command(name="list")
@click.pass_context
def list_cmd(ctx):
    """List all memories for the current scope."""
    t0 = time.time()
    scope = _get_scope(ctx)

    try:
        client = _get_client(ctx)
        results = client.list_all(
            user_id=scope["user_id"],
            agent_id=scope["agent_id"] or None,
            run_id=scope["run_id"] or None,
        )
    except Exception as e:
        duration_ms = int((time.time() - t0) * 1000)
        _echo_error(ctx, "list", str(e), duration_ms)
        ctx.exit(1)
        return

    duration_ms = int((time.time() - t0) * 1000)

    fmt = _get_formatter(ctx)
    if not results and not fmt.is_machine:
        click.echo("No memories found for this scope.")
        return

    _echo_result(ctx, "list", results, duration_ms, count=len(results))


# ---------------------------------------------------------------------------
# delete command
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--all", "delete_all_flag", is_flag=True, required=True, help="Delete all memories for scope")
@click.option("--force", is_flag=True, help="Skip confirmation prompt")
@click.pass_context
def delete(ctx, delete_all_flag, force):
    """Delete all memories for the current scope."""
    t0 = time.time()
    fmt = _get_formatter(ctx)
    scope = _get_scope(ctx)

    if not force and not fmt.is_machine:
        confirmed = click.confirm(
            f"Delete ALL memories for scope user_id={scope['user_id']}?",
            default=False,
        )
        if not confirmed:
            click.echo("Cancelled.")
            return

    try:
        client = _get_client(ctx)
        result = client.delete_all(
            user_id=scope["user_id"],
            agent_id=scope["agent_id"] or None,
            run_id=scope["run_id"] or None,
        )
    except Exception as e:
        duration_ms = int((time.time() - t0) * 1000)
        _echo_error(ctx, "delete", str(e), duration_ms)
        ctx.exit(1)
        return

    duration_ms = int((time.time() - t0) * 1000)
    _echo_result(ctx, "delete", result, duration_ms)


# ---------------------------------------------------------------------------
# config subcommand group
# ---------------------------------------------------------------------------

@cli.group(name="config")
def config_group():
    """View and manage configuration."""
    pass


@config_group.command(name="show")
@click.pass_context
def config_show(ctx):
    """Display current configuration with sensitive fields masked."""
    t0 = time.time()
    raw = load_config()
    if not raw:
        fmt = _get_formatter(ctx)
        if fmt.is_machine:
            _echo_error(ctx, "config show", "No configuration file found. Run 'adbpg-mem init' to create one.", int((time.time() - t0) * 1000))
        else:
            click.echo("No configuration file found. Run 'adbpg-mem init' to create one.")
        ctx.exit(2)
        return

    masked = mask_sensitive(raw)
    duration_ms = int((time.time() - t0) * 1000)
    _echo_result(ctx, "config show", masked, duration_ms)


@config_group.command(name="set")
@click.argument("key")
@click.argument("value")
@click.pass_context
def config_set(ctx, key, value):
    """Set a configuration value."""
    t0 = time.time()
    raw = load_config()

    # Try to convert numeric values
    try:
        converted = int(value)
    except ValueError:
        try:
            converted = float(value)
        except ValueError:
            converted = value

    raw[key] = converted
    save_config(raw)
    duration_ms = int((time.time() - t0) * 1000)

    fmt = _get_formatter(ctx)
    if fmt.is_machine:
        _echo_result(ctx, "config set", {"key": key, "value": converted}, duration_ms)
    else:
        click.echo(f"Set '{key}' = {converted!r}")


@config_group.command(name="path")
@click.pass_context
def config_path(ctx):
    """Show the configuration file path."""
    t0 = time.time()
    duration_ms = int((time.time() - t0) * 1000)
    fmt = _get_formatter(ctx)
    if fmt.is_machine:
        _echo_result(ctx, "config path", {"path": str(CONFIG_FILE)}, duration_ms)
    else:
        click.echo(str(CONFIG_FILE))


# ---------------------------------------------------------------------------
# status command
# ---------------------------------------------------------------------------

@cli.command()
@click.pass_context
def status(ctx):
    """Test connection to ADBPG."""
    t0 = time.time()
    scope = _get_scope(ctx)

    try:
        client = _get_client(ctx)
        success, message = client.test_connection()
    except Exception as e:
        duration_ms = int((time.time() - t0) * 1000)
        _echo_error(ctx, "status", str(e), duration_ms)
        ctx.exit(1)
        return

    duration_ms = int((time.time() - t0) * 1000)

    if success:
        _echo_result(ctx, "status", {"connected": True, "message": message}, duration_ms)
    else:
        _echo_error(ctx, "status", message, duration_ms)
        ctx.exit(1)


# ---------------------------------------------------------------------------
# version command
# ---------------------------------------------------------------------------

@cli.command()
@click.pass_context
def version(ctx):
    """Show the CLI version."""
    t0 = time.time()
    duration_ms = int((time.time() - t0) * 1000)
    fmt = _get_formatter(ctx)
    if fmt.is_machine:
        _echo_result(ctx, "version", {"version": __version__}, duration_ms)
    else:
        click.echo(f"adbpg-mem {__version__}")

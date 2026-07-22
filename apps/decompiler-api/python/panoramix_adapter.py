"""Machine-readable, bytecode-only adapter for pinned Panoramix.

The Node service sends bytecode over stdin. This process deliberately blocks
socket connections and never accepts an address or provider configuration.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import socket
import sys
import traceback


class _NoNetworkSocket(socket.socket):
    def connect(self, _address):
        raise PermissionError("network access is disabled in the Panoramix adapter")

    def connect_ex(self, _address):
        raise PermissionError("network access is disabled in the Panoramix adapter")


def _deny_connection(*_args, **_kwargs):
    raise PermissionError("network access is disabled in the Panoramix adapter")


socket.socket = _NoNetworkSocket
socket.create_connection = _deny_connection

# Defense in depth: the service starts this process with an allowlisted
# environment, but discard provider variables if the adapter is run directly.
for name in tuple(os.environ):
    upper = name.upper()
    if "RPC" in upper or "ETHERSCAN" in upper or "WEB3_PROVIDER" in upper or "API_KEY" in upper:
        os.environ.pop(name, None)

from panoramix.decompiler import decompile_bytecode  # noqa: E402


def main() -> int:
    bytecode = sys.stdin.read().strip()
    stray_stdout = io.StringIO()
    try:
        with contextlib.redirect_stdout(stray_stdout):
            result = decompile_bytecode(bytecode)
        warnings = []
        if output := stray_stdout.getvalue().strip():
            warnings.append(f"Panoramix emitted unexpected stdout: {output}")
        json.dump(
            {
                "schemaVersion": 1,
                "text": result.text,
                "contract": result.json,
                "warnings": warnings,
            },
            sys.stdout,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        return 0
    except BaseException as error:
        json.dump(
            {
                "schemaVersion": 1,
                "adapterError": f"{type(error).__name__}: {error}",
                "warnings": [traceback.format_exc(limit=3)],
            },
            sys.stdout,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

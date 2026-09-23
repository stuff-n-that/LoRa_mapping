#!/usr/bin/env python3
"""Dumps the node database from a locally-connected Meshtastic device as
JSON on stdout, for scripts/pull-local-node.mjs to consume.

Chosen over a JS client library deliberately: at the time this was written,
Meshtastic's own JS/TS client had just moved repos (meshtastic/js ->
meshtastic/web) mid-rewrite with no verifiable usage docs, while
meshtastic-python's Interface.nodes has been a stable, widely-used shape
for years — the same field names (hopsAway, snr, lastHeard) already appear
in the community map backend this project integrates with elsewhere. Needs
`pip install meshtastic` on whatever machine has the device attached.

NOT YET SMOKE-TESTED AGAINST REAL HARDWARE — this environment has no device
to test against. Try it against your node first and expect to fix field
names if the installed meshtastic-python version has drifted from this.

Usage:
    python3 read_meshtastic_nodes.py                 # USB serial, auto-detect
    python3 read_meshtastic_nodes.py --host 192.168.1.50   # Wi-Fi node
"""
import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', help='IP address of a Wi-Fi-connected node; omit for USB serial')
    parser.add_argument('--port', help='Serial port (e.g. /dev/ttyUSB0); omit to auto-detect')
    args = parser.parse_args()

    try:
        if args.host:
            from meshtastic.tcp_interface import TCPInterface
            interface = TCPInterface(hostname=args.host)
        else:
            from meshtastic.serial_interface import SerialInterface
            interface = SerialInterface(devPath=args.port)
    except ImportError:
        print('meshtastic package not installed — run: pip install meshtastic', file=sys.stderr)
        sys.exit(1)

    try:
        nodes = interface.nodes or {}
        # default=str covers any non-JSON-serializable values (e.g. bytes)
        # rather than crashing on a field this script didn't anticipate.
        print(json.dumps(nodes, default=str))
    finally:
        interface.close()


if __name__ == '__main__':
    main()

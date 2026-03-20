#!/usr/bin/env python3
"""
Sidecar script: parse instrument files (.pcrd, .tlpd, .eds, .amxd) to .sharp format.
Called by the Tauri frontend via shell command.

Usage: python parse_instrument.py <input_file>
Output: prints the path to the generated .sharp file on stdout.
Errors: prints error messages to stderr with non-zero exit code.
"""
import sys
import os
import tempfile

# Add v1 source to path
V1_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__),
    "..", "..", "Unwinding data processing"))
if V1_ROOT not in sys.path:
    sys.path.insert(0, V1_ROOT)

def main():
    if len(sys.argv) < 2:
        print("Usage: parse_instrument.py <input_file>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]

    if not os.path.exists(input_path):
        print(f"File not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Import v1 parser
    try:
        from sharp.parser.core import parse_experiment
    except ImportError as e:
        print(f"Failed to import parser: {e}", file=sys.stderr)
        print(f"V1 path: {V1_ROOT}", file=sys.stderr)
        sys.exit(1)

    # Create temp output directory
    output_dir = tempfile.mkdtemp(prefix="sharp_parsed_")

    try:
        result = parse_experiment(input_path, output_dir)

        if result.errors:
            for err in result.errors:
                print(f"Error: {err}", file=sys.stderr)
            sys.exit(1)

        # Find the generated .sharp file
        sharp_files = [f for f in os.listdir(output_dir) if f.endswith('.sharp')]
        if not sharp_files:
            print("Parser ran but no .sharp file was generated", file=sys.stderr)
            sys.exit(1)

        sharp_path = os.path.join(output_dir, sharp_files[0])

        # Print warnings to stderr
        for warn in result.warnings:
            print(f"Warning: {warn}", file=sys.stderr)

        # Print the output path to stdout (this is what the frontend reads)
        print(sharp_path)

    except Exception as e:
        print(f"Parse error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Show disk usage summary for common development directories."""

import os
import platform
import shutil
from pathlib import Path

def format_size(size_bytes):
    """Format bytes to human readable string."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"

def get_dir_size(path):
    """Get total size of a directory."""
    total = 0
    try:
        for entry in os.scandir(path):
            if entry.is_file(follow_symlinks=False):
                total += entry.stat().st_size
            elif entry.is_dir(follow_symlinks=False):
                total += get_dir_size(entry.path)
    except (PermissionError, FileNotFoundError):
        pass
    return total

def main():
    print("💾 Disk Usage Summary")
    print("=" * 50)

    home = Path.home()

    # System disk usage
    total, used, free = shutil.disk_usage("/")
    print(f"\n📁 System Disk:")
    print(f"   Total: {format_size(total)}")
    print(f"   Used:  {format_size(used)} ({100 * used / total:.1f}%)")
    print(f"   Free:  {format_size(free)} ({100 * free / total:.1f}%)")

    # Common development directories (cross-platform)
    is_macos = platform.system() == "Darwin"

    # Base directories that work on both platforms
    dev_dirs = [
        ("~/.cache", "User Cache"),
        ("~/.npm", "npm Cache"),
        ("~/.conda", "Conda Envs"),
        ("~/.local/share/pip", "pip Cache"),
        ("~/.vscode", "VS Code"),
    ]

    # Add macOS-specific directories
    if is_macos:
        dev_dirs.extend([
            ("~/Library/Caches", "macOS Caches"),
            ("~/Library/Developer", "Xcode/Developer"),
            ("~/miniforge3", "Miniforge"),
            ("~/Library/Application Support/Docker", "Docker"),
        ])
    else:
        # Linux-specific directories
        dev_dirs.extend([
            ("~/.local/share", "Local Share"),
            ("~/.config", "Config"),
            ("~/snap", "Snap Packages"),
            ("~/.docker", "Docker"),
        ])

    print(f"\n📂 Development Directories:")
    results = []

    for path_str, label in dev_dirs:
        path = Path(path_str).expanduser()
        if path.exists():
            size = get_dir_size(path)
            results.append((size, label, path))

    # Sort by size descending
    results.sort(key=lambda x: x[0], reverse=True)

    for size, label, path in results:
        if size > 0:
            print(f"   {format_size(size):>10}  {label}")

    # MacRunner specific
    macrunner_data = home / ".macrunner"
    if macrunner_data.exists():
        size = get_dir_size(macrunner_data)
        print(f"\n🏃 MacRunner Data:")
        print(f"   Total: {format_size(size)}")

        # Subdirectories
        for subdir in ["workspaces", "logs"]:
            subpath = macrunner_data / subdir
            if subpath.exists():
                subsize = get_dir_size(subpath)
                print(f"   {subdir}: {format_size(subsize)}")

    print("\n✅ Disk usage summary complete!")

if __name__ == "__main__":
    main()
